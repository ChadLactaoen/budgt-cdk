/**
 * Reads `Budgt` back after the migration and asserts every invariant the API would have
 * enforced had the data gone in through it.
 *
 *   npx ts-node scripts/verify-legacy-migration.ts
 *
 * Read-only. Exits non-zero on the first failure, listing every problem it found.
 */
import { isCategoryId } from '../shared/categories';
import { isFundId } from '../shared/funds';
import { buildFundItems } from './migration/mapping';
import { scanAll, TARGET_TABLE, PROTECTED_PKS } from './migration/ddb';
import type {
  AllocationItem,
  FundItem,
  PeriodItem,
  TransactionItem,
} from '../lambda/api/types';

type Row = Record<string, unknown> & { PK: string; SK: string; type?: string };

const EXPECTED = { PERIOD: 101, ALLOCATION: 3140, TRANSACTION: 8045, FUND: 11 };
/** The live month, entered through the app and untouched by the migration. */
const PROTECTED_ITEM_COUNT = 29;

async function main() {
  const rows = await scanAll<Row>(TARGET_TABLE);
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);

  const protectedRows = rows.filter((r) => PROTECTED_PKS.has(r.PK));
  const migrated = rows.filter((r) => !PROTECTED_PKS.has(r.PK));

  const by = <T>(t: string) => migrated.filter((r) => r.type === t) as unknown as T[];
  const periods = by<PeriodItem>('PERIOD');
  const allocations = by<AllocationItem>('ALLOCATION');
  const transactions = by<TransactionItem>('TRANSACTION');
  const funds = by<FundItem>('FUND');

  console.log(`${rows.length} items in ${TARGET_TABLE}`);
  for (const [type, want] of Object.entries(EXPECTED)) {
    const got = migrated.filter((r) => r.type === type).length;
    console.log(`  ${type.padEnd(12)} ${got} (expected ${want})`);
    if (got !== want) fail(`${type}: ${got} items, expected ${want}`);
  }

  // Anything without a `type` is invisible to every read path, which splits on it.
  const typeless = migrated.filter((r) => !r.type);
  if (typeless.length) fail(`${typeless.length} item(s) with no type: ${typeless[0].PK}/${typeless[0].SK}`);

  console.log(`  protected    ${protectedRows.length} (expected ${PROTECTED_ITEM_COUNT})`);
  if (protectedRows.length !== PROTECTED_ITEM_COUNT) {
    fail(`protected partition holds ${protectedRows.length} items, expected ${PROTECTED_ITEM_COUNT}`);
  }

  // Allocations sum to the period total, exactly, in every month.
  const sums = new Map<string, number>();
  for (const a of allocations) sums.set(a.PK, (sums.get(a.PK) ?? 0) + a.amt);
  for (const p of periods) {
    const sum = sums.get(p.PK) ?? 0;
    if (sum !== p.amt) fail(`${p.PK}: allocations sum to ${sum}, period amt is ${p.amt}`);
  }
  const orphanAllocs = [...sums.keys()].filter((pk) => !periods.some((p) => p.PK === pk));
  for (const pk of orphanAllocs) fail(`${pk}: allocations with no period item`);

  // Every transaction lands in a month that has a period, or getMonth cannot see it.
  const months = new Set(periods.map((p) => p.PK));
  for (const t of transactions) {
    if (!months.has(t.PK)) fail(`transaction ${t.PK}/${t.SK}: no period for this month`);
  }

  // Closed registries: an unknown id resolves to nothing in the UI.
  for (const a of allocations) if (!isCategoryId(a.cat)) fail(`allocation ${a.PK}/${a.SK}: bad cat ${a.cat}`);
  for (const t of transactions) {
    if (!isCategoryId(t.cat)) fail(`transaction ${t.PK}/${t.SK}: bad cat ${t.cat}`);
    if (t.src && !isFundId(t.src)) fail(`transaction ${t.PK}/${t.SK}: bad src ${t.src}`);
    if (!Number.isSafeInteger(t.amt)) fail(`transaction ${t.PK}/${t.SK}: amt ${t.amt} is not an integer`);
  }

  // Fund state is derived, so it must still equal what the transactions imply.
  const derived = buildFundItems(transactions);
  const stored = new Map(funds.map((f) => [`${f.PK}|${f.SK}`, f]));
  for (const d of derived) {
    const s = stored.get(`${d.PK}|${d.SK}`);
    if (!s) {
      fail(`${d.PK}/${d.SK}: derived from transactions but missing from the table`);
      continue;
    }
    if (s.bal !== d.bal || s.dep !== d.dep || s.wd !== d.wd) {
      fail(`${d.PK}/${d.SK}: stored ${s.dep}/${s.wd}/${s.bal}, derived ${d.dep}/${d.wd}/${d.bal}`);
    }
    if (s.bal !== s.dep - s.wd) fail(`${d.PK}/${d.SK}: bal !== dep - wd`);
    stored.delete(`${d.PK}|${d.SK}`);
  }
  for (const k of stored.keys()) fail(`${k}: fund item no transaction accounts for`);

  console.log(`\nbudgeted total ${(periods.reduce((s, p) => s + p.amt, 0) / 100).toFixed(2)}`);
  console.log(`withdrawals    ${transactions.filter((t) => t.src).length}`);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
