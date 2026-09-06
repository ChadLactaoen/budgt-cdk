import type { CategoryId } from '../../../shared/categories';
import { TABLE, TRANSACT_ITEM_LIMIT } from '../config';
import type { Tagged } from '../ddb';
import { ApiError, badRequest } from '../errors';
import { allocSk, monthPk, periodKeys } from '../keys';
import {
  optionalString,
  requireAmount,
  requireCategoryId,
  requireYearMonth,
} from '../validate';

export interface AllocationInput {
  cat: CategoryId;
  amt: number;
}

export interface PeriodInput {
  yearMonth: string;
  amt: number;
  memo: string;
  allocations: AllocationInput[];
}

export function parsePeriodInput(body: Record<string, unknown>): PeriodInput {
  const yearMonth = requireYearMonth(String(body.yearMonth ?? ''));
  const amt = requireAmount(body.amt, 'amt');
  const memo = optionalString(body.memo, 'memo', 500);

  if (!Array.isArray(body.allocations)) {
    throw badRequest('VALIDATION', 'allocations must be an array');
  }

  const seen = new Set<string>();
  const allocations = body.allocations.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw badRequest('VALIDATION', `allocations[${i}] must be an object`);
    }
    const entry = raw as Record<string, unknown>;
    const cat = requireCategoryId(entry.cat);
    if (seen.has(cat)) {
      throw badRequest('DUPLICATE_ALLOCATION', `category appears more than once: ${cat}`);
    }
    seen.add(cat);
    return { cat, amt: requireAmount(entry.amt, `allocations[${i}].amt`) };
  });

  // Exact integer comparison — the whole point of storing cents.
  const sum = allocations.reduce((acc, a) => acc + a.amt, 0);
  if (sum !== amt) {
    throw badRequest(
      'ALLOCATION_SUM_MISMATCH',
      `allocations sum to ${sum} but the period total is ${amt}`,
      { sum, amt },
    );
  }

  return { yearMonth, amt, memo, allocations };
}

/**
 * One transaction: Put the Period, Put every submitted Allocation, Delete every
 * existing Allocation not resubmitted. This is what keeps the "allocations sum to
 * Period.amt" invariant true at every point an observer could read the table.
 *
 * No ConditionExpression anywhere — the write is desired-state and idempotent, so
 * replaying it produces identical table state.
 */
export function buildPeriodTransactItems(input: PeriodInput, existingSks: string[]): Tagged[] {
  const { yearMonth, amt, memo, allocations } = input;
  const submitted = new Set(allocations.map((a) => allocSk(a.cat)));
  const toDelete = existingSks.filter((sk) => !submitted.has(sk));

  const unconditional = (item: Tagged['item']): Tagged => ({
    item,
    onFail: new ApiError(500, 'INTERNAL', 'unconditional write failed'),
  });

  const items: Tagged[] = [
    unconditional({
      Put: { TableName: TABLE, Item: { ...periodKeys(yearMonth), amt, memo, type: 'PERIOD' } },
    }),
    ...allocations.map((a) =>
      unconditional({
        Put: {
          TableName: TABLE,
          Item: { PK: monthPk(yearMonth), SK: allocSk(a.cat), cat: a.cat, amt: a.amt, type: 'ALLOCATION' },
        },
      }),
    ),
    ...toDelete.map((sk) =>
      unconditional({ Delete: { TableName: TABLE, Key: { PK: monthPk(yearMonth), SK: sk } } }),
    ),
  ];

  // Unreachable with the current 62 categories (worst case is 63 items), but a
  // ValidationException here would surface as an opaque 500. If the category set ever
  // approaches ~95, this endpoint needs chunking — which would break the
  // single-transaction invariant above, so it should be caught at review time.
  if (items.length > TRANSACT_ITEM_LIMIT) {
    throw badRequest('TOO_MANY_ALLOCATIONS', `too many allocations: ${items.length} writes needed`);
  }

  return items;
}
