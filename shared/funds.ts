import type { CategoryId } from './categories';

/**
 * A Fund is a pool of money budgeted in one Period and spent in a later one.
 *
 * Deposits are ordinary transactions against the fund's own category. Withdrawals
 * are ordinary transactions filed under the category the money was actually spent
 * on, carrying `src` set to the fund's ID.
 *
 * This registry is closed: `src` is validated against it on every write. An
 * unvalidated `src` would write fund state into a partition nothing reads back.
 */
export interface Fund {
  /** Display name. */
  nm: string;
  /** The category whose transactions deposit into this fund. */
  cat: CategoryId;
}

export const FUNDS = {
  'FUND#RAINY_DAY': { nm: 'Rainy Day', cat: 'SAV_RAINY_DAY' },
} satisfies Record<string, Fund>;

export type FundId = keyof typeof FUNDS;

const FUND_IDS = new Set(Object.keys(FUNDS));

export function isFundId(value: unknown): value is FundId {
  return typeof value === 'string' && FUND_IDS.has(value);
}

/** Reverse index: which fund, if any, a category deposits into. */
export const FUND_BY_CATEGORY: Partial<Record<CategoryId, FundId>> = Object.fromEntries(
  (Object.entries(FUNDS) as Array<[FundId, Fund]>).map(([id, f]) => [f.cat, id]),
) as Partial<Record<CategoryId, FundId>>;
