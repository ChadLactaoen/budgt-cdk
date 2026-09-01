import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CategoryId } from '../shared/categories';
import type { FundId } from '../shared/funds';
import { FUNDS } from '../shared/funds';
import { allocSk, fundKey, monthPk, periodKeys, txKeys } from '../lambda/api/keys';
import type { AllocationItem, FundItem, PeriodItem, TransactionItem } from '../lambda/api/types';

/**
 * Seeds one month of believable data so the Period view can be looked at against a
 * real table. Not a migration: it OWNS the `MONTH#2026-08` partition and the 2026
 * Rainy Day fund item, and clears both before writing, so re-running it is safe and
 * always produces the same table state.
 *
 *   npx ts-node scripts/seed-2026-08.ts
 *
 * The data deliberately exercises the awkward cases: a category allocated but never
 * spent, one spent to the cent, two over budget, a refund, a fund deposit, a fund
 * withdrawal that period maths must ignore, and spend in a category with no
 * allocation at all.
 */
const REGION = 'us-west-2';
const TABLE = 'Budgt';
const YEAR_MONTH = '2026-08';
const YEAR = YEAR_MONTH.slice(0, 4);
const RAINY_DAY: FundId = 'FUND#RAINY_DAY';

const client = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(client);

const ALLOCATIONS: Array<[CategoryId, number]> = [
  // Bills — 220600
  ['BILLS_MORTGAGE', 145000],
  ['BILLS_CAR_INSURANCE', 19000],
  ['BILLS_ELECTRIC', 18000],
  ['BILLS_INTERNET_CABLE', 12000],
  ['BILLS_PHONE', 9500],
  ['BILLS_WATER', 7000],
  ['BILLS_LANDSCAPING', 5600],
  ['BILLS_TRASH', 4500],
  // Entertainment — 24000
  ['ENT_GAMING', 8000],
  ['ENT_MOVIES', 6000],
  ['ENT_EVENTS_ATTRACTIONS', 6000],
  ['ENT_BOOKS', 4000],
  // Essentials — 90000
  ['ESS_GROCERIES', 55000],
  ['ESS_DINING', 20000],
  ['ESS_GAS', 10000],
  ['ESS_DRINKS_SNACKS', 3000],
  ['ESS_HEALTH_PERSONAL_CARE', 2000],
  // Miscellaneous — 35000
  ['MISC_HOME', 15000],
  ['MISC_OTHER', 10000],
  ['MISC_CLOTHING', 6000],
  ['MISC_TRAVEL_LODGING', 4000],
  // Savings — 100000
  ['SAV_RAINY_DAY', 40000],
  ['SAV_INVESTMENTS', 40000],
  ['SAV_IRA', 20000],
  // Subscriptions — 21000
  ['SUBS_MISC_SUBSCRIPTIONS', 11004],
  ['SUBS_AWS', 3000],
  ['SUBS_NETFLIX', 2299],
  ['SUBS_HULU', 1899],
  ['SUBS_HBO_MAX', 1699],
  ['SUBS_APPLE_MUSIC', 1099],
];

interface SeedTx {
  td: string;
  nm: string;
  cat: CategoryId;
  amt: number;
  memo?: string;
  src?: FundId;
}

const TRANSACTIONS: SeedTx[] = [
  // Bills. Car insurance is never touched, so it shows a full allocation left.
  { td: '2026-08-20', nm: 'Bank Loan LLC', cat: 'BILLS_MORTGAGE', amt: 145000, memo: 'August payment' },
  { td: '2026-08-12', nm: 'City Electric', cat: 'BILLS_ELECTRIC', amt: 16422 },
  { td: '2026-08-05', nm: 'Xfinity', cat: 'BILLS_INTERNET_CABLE', amt: 11999 },
  { td: '2026-08-03', nm: 'Verizon', cat: 'BILLS_PHONE', amt: 9500 },
  { td: '2026-08-09', nm: 'City Water & Sewer', cat: 'BILLS_WATER', amt: 5821 },
  { td: '2026-08-06', nm: 'Landscaping Co', cat: 'BILLS_LANDSCAPING', amt: 5600 },
  { td: '2026-08-02', nm: 'Waste Management', cat: 'BILLS_TRASH', amt: 4500 },

  // Essentials.
  { td: '2026-08-27', nm: 'Whole Foods', cat: 'ESS_GROCERIES', amt: 8412 },
  { td: '2026-08-23', nm: 'Safeway', cat: 'ESS_GROCERIES', amt: 7995 },
  { td: '2026-08-18', nm: "Trader Joe's", cat: 'ESS_GROCERIES', amt: 6244 },
  { td: '2026-08-08', nm: 'Costco Wholesale', cat: 'ESS_GROCERIES', amt: 24180, memo: 'Monthly stock-up, includes paper goods' },
  { td: '2026-08-16', nm: 'Sushi Kaito', cat: 'ESS_DINING', amt: 9840, memo: 'Anniversary dinner' },
  { td: '2026-08-24', nm: 'Thai Basil', cat: 'ESS_DINING', amt: 4584 },
  { td: '2026-08-09', nm: 'Tacos El Rey', cat: 'ESS_DINING', amt: 2760 },
  { td: '2026-08-24', nm: 'Shell', cat: 'ESS_GAS', amt: 4130 },
  { td: '2026-08-11', nm: 'Chevron', cat: 'ESS_GAS', amt: 3070 },
  { td: '2026-08-14', nm: '7-Eleven', cat: 'ESS_DRINKS_SNACKS', amt: 2000 },
  { td: '2026-08-19', nm: 'Walgreens', cat: 'ESS_HEALTH_PERSONAL_CARE', amt: 1000 },

  // Savings. The Rainy Day row is a fund DEPOSIT: an ordinary spend for this month.
  { td: '2026-08-15', nm: 'Rainy Day deposit', cat: 'SAV_RAINY_DAY', amt: 40000, memo: 'Auto transfer' },
  { td: '2026-08-04', nm: 'Vanguard', cat: 'SAV_INVESTMENTS', amt: 40000, memo: 'Monthly buy' },
  { td: '2026-08-04', nm: 'Fidelity IRA', cat: 'SAV_IRA', amt: 20000 },

  // Miscellaneous. One withdrawal, one refund, and one category with no allocation.
  { td: '2026-08-26', nm: 'Amazon', cat: 'MISC_OTHER', amt: 5000, memo: 'Standing desk mat', src: RAINY_DAY },
  { td: '2026-08-21', nm: 'Home Depot', cat: 'MISC_HOME', amt: 7800, memo: 'Gutter guards' },
  { td: '2026-08-14', nm: 'REI', cat: 'MISC_HOME', amt: -3800, memo: 'Returned the tent' },
  { td: '2026-08-29', nm: 'Red Cross', cat: 'MISC_DONATIONS', amt: 2500 },

  // Entertainment — both allocated categories run over.
  { td: '2026-08-25', nm: 'Steam', cat: 'ENT_GAMING', amt: 5999, memo: 'Summer sale' },
  { td: '2026-08-11', nm: 'Steam', cat: 'ENT_GAMING', amt: 5957, memo: 'Controller' },
  { td: '2026-08-07', nm: 'AMC Theatres', cat: 'ENT_MOVIES', amt: 4796 },
  { td: '2026-08-28', nm: 'Cinemark Theatres', cat: 'ENT_MOVIES', amt: 2398, memo: 'Two tickets, no concessions' },
  { td: '2026-08-22', nm: 'Hollywood Bowl', cat: 'ENT_EVENTS_ATTRACTIONS', amt: 6000 },
  { td: '2026-08-13', nm: 'Barnes & Noble', cat: 'ENT_BOOKS', amt: 2000 },

  // Subscriptions.
  { td: '2026-08-17', nm: 'Misc Subscriptions', cat: 'SUBS_MISC_SUBSCRIPTIONS', amt: 9286 },
  { td: '2026-08-01', nm: 'AWS', cat: 'SUBS_AWS', amt: 2411 },
  { td: '2026-08-22', nm: 'Netflix', cat: 'SUBS_NETFLIX', amt: 2299 },
  { td: '2026-08-10', nm: 'Hulu', cat: 'SUBS_HULU', amt: 1899 },
  { td: '2026-08-02', nm: 'HBO Max', cat: 'SUBS_HBO_MAX', amt: 1699 },
  { td: '2026-08-17', nm: 'Apple Music', cat: 'SUBS_APPLE_MUSIC', amt: 1099 },
];

/**
 * The uniqueness suffix is normally the wall clock at write time. Deriving it from
 * the date instead makes every seeded transaction ID stable, so a re-run replaces
 * rows rather than accumulating a second copy of the month.
 */
const tsFor = (td: string, i: number) => Date.parse(`${td}T12:00:00Z`) + i;

function periodItem(amt: number): PeriodItem {
  return { ...periodKeys(YEAR_MONTH), amt, memo: 'Seeded sample data', type: 'PERIOD' };
}

function allocationItems(): AllocationItem[] {
  return ALLOCATIONS.map(([cat, amt]) => ({
    PK: monthPk(YEAR_MONTH),
    SK: allocSk(cat),
    cat,
    amt,
    type: 'ALLOCATION',
  }));
}

function transactionItems(): TransactionItem[] {
  return TRANSACTIONS.map((t, i) => {
    const item: TransactionItem = {
      ...txKeys(t.td, tsFor(t.td, i)),
      td: t.td,
      nm: t.nm,
      cat: t.cat,
      amt: t.amt,
      type: 'TRANSACTION',
    };
    if (t.src) item.src = t.src;
    if (t.memo) item.memo = t.memo;
    return item;
  });
}

/**
 * Derived from the seeded transactions rather than typed out, so `bal === dep - wd`
 * holds by construction — the same invariant the API maintains with `ADD`.
 */
function fundItem(): FundItem {
  const depositCat = FUNDS[RAINY_DAY].cat;
  const dep = TRANSACTIONS.filter((t) => t.cat === depositCat && !t.src).reduce((s, t) => s + t.amt, 0);
  const wd = TRANSACTIONS.filter((t) => t.src === RAINY_DAY).reduce((s, t) => s + t.amt, 0);
  return { ...fundKey(RAINY_DAY, YEAR), bal: dep - wd, dep, wd, type: 'FUND' };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** BatchWrite silently returns what it did not write; retrying is not optional. */
async function batchWrite(requests: Array<Record<string, unknown>>) {
  for (const group of chunk(requests, 25)) {
    let pending = group;
    for (let attempt = 0; pending.length && attempt < 8; attempt++) {
      const res = await doc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: pending } }));
      pending = (res.UnprocessedItems?.[TABLE] ?? []) as typeof pending;
      if (pending.length) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
    if (pending.length) throw new Error(`${pending.length} items never written`);
  }
}

async function clearMonth() {
  const keys: Array<{ PK: string; SK: string }> = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': monthPk(YEAR_MONTH) },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: start,
      }),
    );
    for (const item of res.Items ?? []) keys.push({ PK: String(item.PK), SK: String(item.SK) });
    start = res.LastEvaluatedKey;
  } while (start);

  keys.push(fundKey(RAINY_DAY, YEAR));
  if (keys.length) await batchWrite(keys.map((Key) => ({ DeleteRequest: { Key } })));
  return keys.length;
}

async function main() {
  const total = ALLOCATIONS.reduce((sum, [, amt]) => sum + amt, 0);
  const spent = TRANSACTIONS.filter((t) => !t.src).reduce((sum, t) => sum + t.amt, 0);
  const fund = fundItem();

  const removed = await clearMonth();
  console.log(`cleared ${removed} existing item(s)`);

  const items = [
    periodItem(total),
    ...allocationItems(),
    ...transactionItems(),
    fund,
  ];
  await batchWrite(items.map((Item) => ({ PutRequest: { Item } })));

  console.log(`wrote ${items.length} items to ${TABLE} (${REGION})`);
  console.log(`  period    ${YEAR_MONTH}`);
  console.log(`  allocated ${(total / 100).toFixed(2)} across ${ALLOCATIONS.length} categories`);
  console.log(`  spent     ${(spent / 100).toFixed(2)} across ${TRANSACTIONS.length} transactions`);
  console.log(`  left      ${((total - spent) / 100).toFixed(2)}`);
  console.log(`  rainy day bal ${(fund.bal / 100).toFixed(2)} (dep ${fund.dep / 100}, wd ${fund.wd / 100})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
