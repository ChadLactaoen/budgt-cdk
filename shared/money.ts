/**
 * All monetary values are signed integer cents. $11.99 is 1199.
 *
 * DynamoDB's `N` type is exact fixed-point decimal, but the SDK unmarshals it into
 * a JavaScript double, where 11.99 has no exact binary representation. Integers
 * keep sums exact, make `left === 0` mean what it says, and stop drift from
 * accumulating across a year of incremental fund updates.
 *
 * Conversion happens only here, at the frontend's edges.
 */

/** True for a value usable as an amount: an exact, safe integer. */
export function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** 1199 -> "$11.99". Negative amounts render as "-$11.99". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** 1199 -> "11.99", for populating a form input. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * "11.99", "$11.99", "1,199" -> cents. Returns null when the input is not a
 * well-formed amount, so callers can surface a validation error.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^-?\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '-') return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
