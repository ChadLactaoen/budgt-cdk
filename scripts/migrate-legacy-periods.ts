/**
 * Migrates the legacy `Period` table into `Budgt`.
 *
 *   npx ts-node scripts/migrate-legacy-periods.ts            # dry run, writes nothing
 *   npx ts-node scripts/migrate-legacy-periods.ts --apply
 *
 * Legacy embedded a month's allocations in the period row; the current model explodes
 * them into sibling items under the same partition. Run this BEFORE the transaction
 * migration: a transaction filed into a month with no Period item is invisible to
 * `getMonth`, so the table would be readable-but-wrong in between.
 *
 * It owns every `MONTH#<ym>` partition named by the source, and clears each period and
 * allocation there before writing — but leaves transactions alone, so re-running it after
 * the transaction migration does not wipe the history.
 */
import { buildPeriodItems, cents, type LegacyPeriod } from './migration/mapping';
import { APPLY, batchWrite, clearPartitions, scanAll, TARGET_TABLE, REGION } from './migration/ddb';

const SOURCE_TABLE = 'Period';

async function main() {
  const rows = await scanAll<LegacyPeriod>(SOURCE_TABLE);
  console.log(`scanned ${rows.length} rows from ${SOURCE_TABLE} (${REGION})`);

  const { periods, allocations, skipped } = buildPeriodItems(rows);

  for (const s of skipped) console.log(`  skipped ${s.startDate}: ${s.reason}`);
  console.log(`\nwill write ${periods.length} PERIOD + ${allocations.length} ALLOCATION items`);

  // The invariant the API enforces on every write, checked here before anything lands:
  // exact integer equality, which is the whole point of storing cents.
  const byMonth = new Map<string, number>();
  for (const a of allocations) byMonth.set(a.PK, (byMonth.get(a.PK) ?? 0) + a.amt);
  for (const p of periods) {
    const sum = byMonth.get(p.PK) ?? 0;
    if (sum !== p.amt) throw new Error(`${p.PK}: allocations sum to ${sum}, period total is ${p.amt}`);
  }
  console.log('allocation sums match every period total');

  const sourceTotal = rows
    .filter((r) => !skipped.some((s) => s.startDate === r.startDate))
    .reduce((s, r) => s + cents(r.total), 0);
  const written = periods.reduce((s, p) => s + p.amt, 0);
  if (sourceTotal !== written) throw new Error(`total drift: source ${sourceTotal}, target ${written}`);
  console.log(`budgeted total reconciles: ${(written / 100).toFixed(2)}`);

  console.log('\nsample:');
  console.log('  period    ', JSON.stringify(periods[0]));
  console.log('  allocation', JSON.stringify(allocations[0]));
  console.log('  last      ', JSON.stringify(periods[periods.length - 1]));

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.');
    return;
  }

  // Only the period and its allocations: a transaction in this partition was migrated by
  // the other script and must survive a re-run here.
  const months = periods.map((p) => p.PK);
  const removed = await clearPartitions(months, (k) => k.SK.startsWith('DAY#'));
  console.log(`\ncleared ${removed} existing period/allocation item(s)`);

  await batchWrite([...periods, ...allocations].map((Item) => ({ PutRequest: { Item } })));
  console.log(`wrote ${periods.length + allocations.length} items to ${TARGET_TABLE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
