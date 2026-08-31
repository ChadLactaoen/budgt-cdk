import { FUND_BY_CATEGORY, type FundId } from '../../../shared/funds';
import type { CategoryId } from '../../../shared/categories';
import { yyyy } from '../keys';

/** The fund-relevant shape of a transaction. */
export interface TxLike {
  td: string;
  cat: CategoryId;
  amt: number;
  src?: FundId;
}

export interface FundEffect {
  fund: FundId;
  year: string;
  bal: number;
  dep: number;
  wd: number;
}

export type FundDelta = FundEffect;

/**
 * A transaction's effect on a fund is derived from (td, cat, src, amt) — never stored.
 *
 * `src` wins over a fund-backed `cat`: the presence of a funding source is what
 * makes a transaction a withdrawal.
 *
 * The invariant `bal === dep - wd` holds by construction on every path.
 */
export function effect(tx: TxLike | null): FundEffect | null {
  if (tx === null) return null;
  if (tx.src) {
    return { fund: tx.src, year: yyyy(tx.td), bal: -tx.amt, dep: 0, wd: tx.amt };
  }
  const fund = FUND_BY_CATEGORY[tx.cat];
  if (fund) {
    return { fund, year: yyyy(tx.td), bal: tx.amt, dep: tx.amt, wd: 0 };
  }
  return null;
}

/**
 * Reverse the previous effect and apply the new one. One rule covers every case:
 * amount changes, moving into or out of a fund, and swapping deposit for withdrawal.
 *
 * Returns at most two deltas — the old effect touches at most one fund-year and the
 * new effect at most one. They differ when an edit crosses a year boundary, since a
 * Fund item is keyed by year; both must then be updated in the same transaction.
 *
 * Zero-valued deltas are dropped: a no-op Update is a wasted write, and a conditioned
 * no-op could fail for no reason.
 */
export function fundDelta(oldTx: TxLike | null, newTx: TxLike | null): FundDelta[] {
  const acc = new Map<string, FundDelta>();

  const apply = (e: FundEffect | null, sign: 1 | -1) => {
    if (!e) return;
    const key = `${e.fund}|${e.year}`;
    const d = acc.get(key) ?? { fund: e.fund, year: e.year, bal: 0, dep: 0, wd: 0 };
    d.bal += sign * e.bal;
    d.dep += sign * e.dep;
    d.wd += sign * e.wd;
    acc.set(key, d);
  };

  apply(effect(oldTx), -1);
  apply(effect(newTx), 1);

  return [...acc.values()].filter((d) => d.bal !== 0 || d.dep !== 0 || d.wd !== 0);
}
