import { isCategoryId, type CategoryId } from '../../shared/categories';
import { isFundId, type FundId } from '../../shared/funds';
import { isValidAmount } from '../../shared/money';
import { badRequest } from './errors';
import { isIsoDate } from './keys';

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;

export function requireYearMonth(value: string): string {
  if (!YEAR_MONTH.test(value)) {
    throw badRequest('VALIDATION', `invalid period format: ${value}. Use YYYY-MM`);
  }
  return value;
}

export function requireYear(value: string): string {
  if (!YEAR.test(value)) throw badRequest('VALIDATION', `invalid year: ${value}. Use YYYY`);
  return value;
}

export function requireDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isIsoDate(value)) {
    throw badRequest('VALIDATION', `${field} must be a real calendar date in YYYY-MM-DD form`);
  }
  return value;
}

export function requireAmount(value: unknown, field: string): number {
  if (!isValidAmount(value)) {
    throw badRequest('VALIDATION', `${field} must be an integer number of cents`);
  }
  return value;
}

export function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest('VALIDATION', `${field} is required`);
  }
  if (value.length > max) throw badRequest('VALIDATION', `${field} exceeds ${max} characters`);
  return value;
}

export function optionalString(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw badRequest('VALIDATION', `${field} must be a string`);
  if (value.length > max) throw badRequest('VALIDATION', `${field} exceeds ${max} characters`);
  return value;
}

export function requireCategoryId(value: unknown): CategoryId {
  if (!isCategoryId(value)) {
    throw badRequest('UNKNOWN_CATEGORY', `unknown category: ${String(value)}`);
  }
  return value;
}

/**
 * `src` names a fund and must come from the closed registry. An unvalidated value
 * would write fund state into a partition nothing ever reads back.
 */
export function optionalFundId(value: unknown): FundId | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isFundId(value)) throw badRequest('UNKNOWN_FUND', `unknown fund: ${String(value)}`);
  return value;
}
