import type { FundId } from '../../shared/funds';

/** "2026-08-07" -> "2026-08" */
export const ym = (td: string) => td.slice(0, 7);
/** "2026-08-07" -> "2026" */
export const yyyy = (td: string) => td.slice(0, 4);
/** "2026-08-07" -> "08" */
export const mm = (td: string) => td.slice(5, 7);
/** "2026-08-07" -> "07" */
export const dd = (td: string) => td.slice(8, 10);

export const periodKeys = (yearMonth: string) => ({
  PK: `MONTH#${yearMonth}`,
  SK: `MONTH#${yearMonth}`,
  GSI1PK: `YEAR#${yearMonth.slice(0, 4)}`,
  GSI1SK: `MONTH#${yearMonth.slice(5, 7)}`,
});

export const monthPk = (yearMonth: string) => `MONTH#${yearMonth}`;
export const allocSk = (cat: string) => `CAT#${cat}`;
export const yearGsiPk = (year: string) => `YEAR#${year}`;

export const txKeys = (td: string, ts: number) => ({
  PK: `MONTH#${ym(td)}`,
  SK: `DAY#${dd(td)}#TS#${ts}`,
  GSI1PK: `YEAR#${yyyy(td)}`,
  GSI1SK: `MONTH#${mm(td)}#DAY#${dd(td)}#TS#${ts}`,
});

export const fundKey = (fund: FundId, year: string) => ({ PK: fund, SK: `YEAR#${year}` });

export const TEMPLATE_PK = 'TMP#';
export const templateSk = (templateName: string) => `TX#${templateName}`;

/**
 * The public ID of a Transaction. Note this is NOT stable across an edit: `td` is
 * editable, so changing the date changes the ID. Callers must adopt the ID
 * returned by a write.
 */
export const formatTxId = (td: string, ts: number) => `${td}_${ts}`;

/**
 * `epochMillis` alone cannot locate a Transaction: the month is needed for the
 * partition key and the day for the sort key. Both are recoverable here.
 */
export function parseTxId(id: string): { td: string; ts: number } | null {
  const i = id.lastIndexOf('_');
  if (i <= 0) return null;
  const td = id.slice(0, i);
  const rawTs = id.slice(i + 1);
  if (!/^\d{1,15}$/.test(rawTs)) return null;
  if (!isIsoDate(td)) return null;
  return { td, ts: Number(rawTs) };
}

/** True only for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
