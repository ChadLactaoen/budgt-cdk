/**
 * Migrates the legacy `Transaction` table into `Budgt`, and derives the `FUND` items
 * that go with it.
 *
 *   npx ts-node scripts/migrate-legacy-transactions.ts            # dry run, writes nothing
 *   npx ts-node scripts/migrate-legacy-transactions.ts --apply
 *
 * Run AFTER `migrate-legacy-periods.ts`. Fund items are written here rather than in their
 * own script because they are a pure function of the transaction set — deriving them
 * anywhere else would let the two drift.
 */
import { FUNDS } from '../shared/funds';
import {
  buildFundItems,
  buildTransactionItems,
  type LegacyTransaction,
} from './migration/mapping';
import { APPLY, batchWrite, clearPartitions, scanAll, TARGET_TABLE, REGION } from './migration/ddb';

const SOURCE_TABLE = 'Transaction';

async function main() {
  const rows = await scanAll<LegacyTransaction>(SOURCE_TABLE);
  console.log(`scanned ${rows.length} rows from ${SOURCE_TABLE} (${REGION})`);

  const { items, skipped } = buildTransactionItems(rows);
  const funds = buildFundItems(items);

  const reasons = new Map<string, number>();
  for (const s of skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  for (const [reason, n] of reasons) console.log(`  skipped ${n}: ${reason}`);

  const withdrawals = items.filter((t) => t.src);
  console.log(`\nwill write ${items.length} TRANSACTION items (${withdrawals.length} with src)`);
  for (const f of Object.keys(FUNDS)) {
    console.log(`  ${f}: ${withdrawals.filter((t) => t.src === f).length} withdrawal(s)`);
  }

  console.log(`\nwill write ${funds.length} FUND items`);
  for (const f of funds) {
    const flag = f.bal < 0 ? '  <-- negative, no carryover across years' : '';
    console.log(
      `  ${f.PK.padEnd(22)} ${f.SK}  dep=${String(f.dep).padStart(9)}` +
        ` wd=${String(f.wd).padStart(9)} bal=${String(f.bal).padStart(9)}${flag}`,
    );
    if (f.bal !== f.dep - f.wd) throw new Error(`${f.PK}/${f.SK}: bal !== dep - wd`);
  }

  // The keys are synthesized, so a collision would silently drop a transaction.
  const keys = new Set(items.map((t) => `${t.PK}|${t.SK}`));
  if (keys.size !== items.length) throw new Error(`${items.length - keys.size} duplicate transaction key(s)`);

  console.log('\nsample:');
  console.log('  first     ', JSON.stringify(items[0]));
  console.log('  withdrawal', JSON.stringify(withdrawals[0]));
  console.log('  last      ', JSON.stringify(items[items.length - 1]));

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.');
    return;
  }

  // Only the transactions: the period and its allocations belong to the other script.
  const months = [...new Set(items.map((t) => t.PK))];
  const removed = await clearPartitions(months, (k) => !k.SK.startsWith('DAY#'));
  const removedFunds = await clearPartitions([...new Set(funds.map((f) => f.PK))]);
  console.log(`\ncleared ${removed} existing transaction(s) and ${removedFunds} fund item(s)`);

  await batchWrite([...items, ...funds].map((Item) => ({ PutRequest: { Item } })));
  console.log(`wrote ${items.length + funds.length} items to ${TARGET_TABLE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
