/**
 * The legacy -> current translation, kept pure and in one place so the two migration
 * scripts and the verifier cannot drift from each other.
 *
 * The predecessor app stored dollars as floats and referenced categories by a
 * `{ name, parent }` pair resolved against a `Category` table. Neither survives: money
 * is signed integer cents (`shared/money.ts`) and categories are code-defined IDs
 * (`shared/categories.ts`). Everything below is that translation and nothing else — no
 * AWS calls live here, so the transforms can be exercised without credentials.
 */
import { isCategoryId, type CategoryId } from '../../shared/categories';
import { FUND_BY_CATEGORY, type FundId } from '../../shared/funds';
import { allocSk, fundKey, isIsoDate, monthPk, periodKeys, txKeys, yyyy } from '../../lambda/api/keys';
import type { AllocationItem, FundItem, PeriodItem, TransactionItem } from '../../lambda/api/types';

/* ---- Source shapes ------------------------------------------------------------- */

export interface LegacyCategory {
  name: string;
  parent: string;
  color?: string;
}

export interface LegacyAllocation {
  category: LegacyCategory;
  total: number;
  /** Always 0 in every source row; the current model derives counts from transactions. */
  count?: number;
}

export interface LegacyPeriod {
  startDate: string;
  total: number;
  notes?: string;
  allocations: LegacyAllocation[];
}

export interface LegacyTransaction {
  transactionId: string;
  category: LegacyCategory;
  /** Absent on 59 write artifacts, which carry nothing but an id and a category. */
  date?: string;
  name?: string;
  price?: number;
  memo?: string;
  /** Present only on a fund withdrawal: what the fund's money was actually spent on. */
  subcategory?: LegacyCategory;
  /** Redundant with `date`; verified equal to its month/year on every source row. */
  effectivePeriod?: string;
  effectiveYear?: string;
}

/* ---- Category mapping ---------------------------------------------------------- */

const key = (c: LegacyCategory) => `${c.parent}>${c.name}`;

/**
 * Every `(parent, name)` pair that appears in the legacy `Period` or `Transaction`
 * tables. Three groups are not straight name matches:
 *
 *   - `Electric*` / `Gas*` — the trailing star marked an estimated bill and was dropped.
 *   - `Bills > AWS|Netflix|Cinemark|Apple Music` — these four services were filed under
 *     Bills until late 2020 and then re-parented to Subscriptions. They collapse onto the
 *     SUBS_* IDs so each service reads as one continuous series. Safe because no single
 *     period ever allocated both variants, so no two allocations claim one `CAT#` key.
 *   - Four IDs that exist only for this history and are `active: false`.
 */
export const CATEGORY_MAP: Record<string, CategoryId> = {
  'Bills>Car': 'BILLS_CAR',
  'Bills>Car Insurance': 'BILLS_CAR_INSURANCE',
  'Bills>Electric*': 'BILLS_ELECTRIC',
  'Bills>Gas*': 'BILLS_GAS',
  'Bills>HOA': 'BILLS_HOA',
  'Bills>Home Security': 'BILLS_HOME_SECURITY',
  'Bills>Internet & Cable': 'BILLS_INTERNET_CABLE',
  'Bills>Landscaping': 'BILLS_LANDSCAPING',
  'Bills>Mortgage': 'BILLS_MORTGAGE',
  'Bills>Phone': 'BILLS_PHONE',
  'Bills>Property Taxes': 'BILLS_PROPERTY_TAXES',
  'Bills>Sewer': 'BILLS_SEWER',
  'Bills>Solar': 'BILLS_SOLAR',
  'Bills>Trash': 'BILLS_TRASH',
  'Bills>Water': 'BILLS_WATER',
  'Bills>Rent*': 'BILLS_RENT',
  'Bills>Renters Insurance': 'BILLS_RENTERS_INSURANCE',
  'Bills>Water Softener': 'BILLS_WATER_SOFTENER',

  // Re-parented to Subscriptions in late 2020.
  'Bills>AWS': 'SUBS_AWS',
  'Bills>Netflix': 'SUBS_NETFLIX',
  'Bills>Cinemark': 'SUBS_CINEMARK',
  'Bills>Apple Music': 'SUBS_APPLE_MUSIC',

  'Entertainment>Art & Hobbies': 'ENT_ART_HOBBIES',
  'Entertainment>Books': 'ENT_BOOKS',
  'Entertainment>Digital Music': 'ENT_DIGITAL_MUSIC',
  'Entertainment>Events & Attractions': 'ENT_EVENTS_ATTRACTIONS',
  'Entertainment>Gambling': 'ENT_GAMBLING',
  'Entertainment>Gaming': 'ENT_GAMING',
  'Entertainment>Movies': 'ENT_MOVIES',

  'Essentials>Dining': 'ESS_DINING',
  'Essentials>Drinks & Snacks': 'ESS_DRINKS_SNACKS',
  'Essentials>Gas': 'ESS_GAS',
  'Essentials>Groceries': 'ESS_GROCERIES',
  'Essentials>Health & Personal Care': 'ESS_HEALTH_PERSONAL_CARE',

  'Miscellaneous>Clothing': 'MISC_CLOTHING',
  'Miscellaneous>Donations': 'MISC_DONATIONS',
  'Miscellaneous>Home': 'MISC_HOME',
  'Miscellaneous>Other': 'MISC_OTHER',
  'Miscellaneous>Travel & Lodging': 'MISC_TRAVEL_LODGING',

  'Savings>Advance': 'SAV_ADVANCE',
  'Savings>Crypto': 'SAV_CRYPTO',
  'Savings>IRA': 'SAV_IRA',
  'Savings>Investments': 'SAV_INVESTMENTS',
  'Savings>Rainy Day': 'SAV_RAINY_DAY',
  'Savings>Savings': 'SAV_SAVINGS',
  'Savings>Gambling Fund': 'SAV_GAMBLING_FUND',

  'Subscriptions>AWS': 'SUBS_AWS',
  'Subscriptions>Amazon Prime': 'SUBS_AMAZON_PRIME',
  'Subscriptions>Apple Music': 'SUBS_APPLE_MUSIC',
  'Subscriptions>Apple TV+': 'SUBS_APPLE_TV_PLUS',
  'Subscriptions>Arlo': 'SUBS_ARLO',
  'Subscriptions>Cinemark': 'SUBS_CINEMARK',
  'Subscriptions>HBO Max': 'SUBS_HBO_MAX',
  'Subscriptions>HelloFresh': 'SUBS_HELLOFRESH',
  'Subscriptions>Hulu': 'SUBS_HULU',
  'Subscriptions>Misc Subscriptions': 'SUBS_MISC_SUBSCRIPTIONS',
  'Subscriptions>NBA': 'SUBS_NBA',
  'Subscriptions>Netflix': 'SUBS_NETFLIX',
  'Subscriptions>Numberfire': 'SUBS_NUMBERFIRE',
  'Subscriptions>Paramount+': 'SUBS_PARAMOUNT_PLUS',
  'Subscriptions>Peacock': 'SUBS_PEACOCK',
  'Subscriptions>Pest Control': 'SUBS_PEST_CONTROL',
  'Subscriptions>Twitch': 'SUBS_TWITCH',
  'Subscriptions>Viki': 'SUBS_VIKI',
  'Subscriptions>YouTube Premium': 'SUBS_YOUTUBE_PREMIUM',
};

/** Throws rather than defaulting: an unmapped pair is a mapping bug, not a data point. */
export function mapCategory(c: LegacyCategory): CategoryId {
  const id = CATEGORY_MAP[key(c)];
  if (!id) throw new Error(`unmapped legacy category: ${key(c)}`);
  if (!isCategoryId(id)) throw new Error(`${key(c)} maps to ${id}, which is not a category ID`);
  return id;
}

/**
 * Seven Rainy Day withdrawals carry a negative price but no `subcategory`, so the
 * withdrawal rule has no spending category to file them under. Hand-mapped, keyed by the
 * legacy uuid, and reviewed row by row.
 */
export const WITHDRAWAL_CAT_OVERRIDES: Record<string, CategoryId> = {
  '80c1d549-9270-4133-a0b7-347dfbc10ef0': 'SUBS_AMAZON_PRIME', // 2019-06-18 Amazon Prime $119.00
  'b4c38a74-be5b-4a29-9081-c398c53e1604': 'MISC_TRAVEL_LODGING', // 2019-06-26 Chase Travel $237.55
  '4cfc22b0-e83e-4827-8284-347c576d5a74': 'MISC_OTHER', // 2019-07-08 Amazon $124.69
  'f6553e33-8047-4915-8468-c9af3dcb77b8': 'MISC_OTHER', // 2019-08-13 Withdrawal $300.00, transfer to mom
  'a0abc560-fb94-45c8-89b4-a8725eba8f0f': 'MISC_OTHER', // 2019-10-01 Chase Membership Fee $450.00
  '85c71324-1240-4c70-88f9-3cdedec920bc': 'BILLS_CAR', // 2019-11-16 DMV $633.00
  '604341f9-62f0-4c04-ac77-890873b88d55': 'SUBS_AMAZON_PRIME', // 2020-06-19 Amazon Prime $119.00
};

/* ---- Scalars ------------------------------------------------------------------- */

/** Legacy stores dollars as a float. Round once, here, and never see a float again. */
export const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * The uniqueness suffix is normally the wall clock at write time, which legacy never
 * recorded. Deriving it from the date plus a within-day index makes every migrated key
 * stable, so a re-run replaces rows instead of accumulating a second copy of the history.
 */
export const tsFor = (td: string, i: number) => Date.parse(`${td}T12:00:00Z`) + i;

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ---- Period transform ---------------------------------------------------------- */

export interface PeriodResult {
  periods: PeriodItem[];
  allocations: AllocationItem[];
  /** `startDate` values rejected as malformed, with the reason. */
  skipped: Array<{ startDate: string; reason: string }>;
}

export function buildPeriodItems(rows: LegacyPeriod[]): PeriodResult {
  const periods: PeriodItem[] = [];
  const allocations: AllocationItem[] = [];
  const skipped: PeriodResult['skipped'] = [];

  for (const row of [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    // One source row is keyed `04-2025` — an MM-YYYY typo. `2025-04` already exists as a
    // well-formed period with its own figures and no transaction references the typo, so
    // migrating it would fabricate a thirteenth month for 2025.
    if (!YEAR_MONTH.test(row.startDate)) {
      skipped.push({ startDate: row.startDate, reason: 'startDate is not YYYY-MM' });
      continue;
    }

    periods.push({
      ...periodKeys(row.startDate),
      amt: cents(row.total),
      // PeriodItem.memo is `string`, never undefined; only 20 of 102 rows carry notes.
      memo: row.notes ?? '',
      type: 'PERIOD',
    });

    for (const a of row.allocations) {
      const cat = mapCategory(a.category);
      allocations.push({
        PK: monthPk(row.startDate),
        SK: allocSk(cat),
        cat,
        amt: cents(a.total),
        type: 'ALLOCATION',
      });
    }
  }

  return { periods, allocations, skipped };
}

/* ---- Transaction transform ------------------------------------------------------ */

export interface TransactionResult {
  items: TransactionItem[];
  skipped: Array<{ transactionId: string; reason: string }>;
}

/**
 * Legacy encodes a fund withdrawal as a NEGATIVE price on the fund's own Savings
 * category, with `subcategory` naming what the money was actually spent on. The current
 * model inverts both halves: the transaction is filed under the spending category with a
 * POSITIVE amount and a `src` pointing at the fund, and `domain/funds.ts#effect` turns
 * that into `bal: -amt, wd: amt`. Getting the sign flip wrong would double every
 * withdrawal rather than reverse it.
 */
function withdrawalOf(row: LegacyTransaction, cid: CategoryId, amt0: number) {
  const fund: FundId | undefined = FUND_BY_CATEGORY[cid];
  if (!fund) return null;
  if (!row.subcategory && amt0 >= 0) return null;

  const cat = row.subcategory
    ? mapCategory(row.subcategory)
    : WITHDRAWAL_CAT_OVERRIDES[row.transactionId];

  // Defaulting here would file a new orphan under the wrong category silently.
  if (!cat) {
    throw new Error(
      `withdrawal ${row.transactionId} (${row.date} ${row.name}) has no subcategory and no override`,
    );
  }
  return { cat, amt: -amt0, src: fund };
}

export function buildTransactionItems(rows: LegacyTransaction[]): TransactionResult {
  const items: TransactionItem[] = [];
  const skipped: TransactionResult['skipped'] = [];

  const usable: LegacyTransaction[] = [];
  for (const row of rows) {
    // 59 rows carry nothing but an id and a category — write artifacts with no date, name
    // or price. There is nothing to recover from them.
    if (!row.date || row.name === undefined || row.price === undefined) {
      skipped.push({ transactionId: row.transactionId, reason: 'missing date, name or price' });
      continue;
    }
    if (!isIsoDate(row.date)) {
      skipped.push({ transactionId: row.transactionId, reason: `invalid date: ${row.date}` });
      continue;
    }
    usable.push(row);
  }

  // A Scan returns rows in arbitrary order, so the within-day index has to come from a
  // deterministic sort or `ts` would shift between runs and orphan the previous keys.
  usable.sort((a, b) => a.date!.localeCompare(b.date!) || a.transactionId.localeCompare(b.transactionId));

  let day = '';
  let i = 0;
  for (const row of usable) {
    if (row.date !== day) {
      day = row.date!;
      i = 0;
    }

    const cid = mapCategory(row.category);
    const amt0 = cents(row.price!);
    const wd = withdrawalOf(row, cid, amt0);

    const item: TransactionItem = {
      ...txKeys(row.date!, tsFor(row.date!, i)),
      td: row.date!,
      nm: row.name!,
      cat: wd ? wd.cat : cid,
      amt: wd ? wd.amt : amt0,
      type: 'TRANSACTION',
    };
    if (wd) item.src = wd.src;

    // Two rows carry a `subcategory` under a category that is not a fund, so there is no
    // `src` to hold it. Keeping it in the memo beats dropping it on the floor.
    const notes = [row.memo];
    if (!wd && row.subcategory) notes.push(`via ${row.subcategory.parent} > ${row.subcategory.name}`);
    const memo = notes.filter(Boolean).join(' — ');
    if (memo) item.memo = memo;

    items.push(item);
    i++;
  }

  return { items, skipped };
}

/* ---- Fund transform ------------------------------------------------------------- */

/**
 * Fund state is derived, never stored on a transaction, so it is rebuilt here by
 * replaying `domain/funds.ts#effect` over the migrated set and grouping by
 * `(fund, year)` — the same shape the API maintains incrementally with `ADD`.
 *
 * `bal === dep - wd` holds by construction. It can be negative: the Fund item is keyed by
 * year, which implies a Jan 1 reset with no carryover, and in 2022 and 2023 the legacy
 * data spent a balance built up in earlier years. That is a true statement about those
 * years, and the FUND_OVERDRAW guard only applies to new writes.
 */
export function buildFundItems(items: TransactionItem[]): FundItem[] {
  const acc = new Map<string, FundItem>();

  const at = (fund: FundId, year: string) => {
    const k = `${fund}|${year}`;
    let f = acc.get(k);
    if (!f) {
      f = { ...fundKey(fund, year), bal: 0, dep: 0, wd: 0, type: 'FUND' };
      acc.set(k, f);
    }
    return f;
  };

  for (const t of items) {
    const year = yyyy(t.td);
    // `src` wins over a fund-backed `cat`, exactly as `effect()` decides it.
    if (t.src) {
      at(t.src, year).wd += t.amt;
      continue;
    }
    const fund = FUND_BY_CATEGORY[t.cat];
    if (fund) at(fund, year).dep += t.amt;
  }

  for (const f of acc.values()) f.bal = f.dep - f.wd;

  return [...acc.values()].sort((a, b) => a.PK.localeCompare(b.PK) || a.SK.localeCompare(b.SK));
}
