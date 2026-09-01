import { MASK, MASK_COMPACT, privacy } from '../../stores/privacy';

/**
 * The formatting HMoney renders, exported separately because the dense mono lines in
 * the design — ratios, deltas, "spent of allocated" — are plain text, not amounts big
 * enough to deserve a component. Routing them through here is what keeps a new figure
 * from shipping unmasked.
 *
 * Both carry a minus on a negative figure — that is part of the number, not an
 * optional sign — using the true minus U+2212, never a hyphen. A leading + is the
 * caller's business.
 */

/** 1199 -> "$11.99", -1199 -> "−$11.99". */
export function formatAmount(cents: number, currency = '$'): string {
  if (privacy.value) return MASK;
  return (
    (cents < 0 ? '−' : '') +
    currency +
    Math.abs(cents / 100).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** 1199 -> "$12". Whole units, for a figure that is a glance rather than a reconciliation. */
export function formatCompact(cents: number, currency = '$'): string {
  if (privacy.value) return MASK_COMPACT;
  return (cents < 0 ? '−' : '') + currency + Math.round(Math.abs(cents) / 100).toLocaleString('en-GB');
}
