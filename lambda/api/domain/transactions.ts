import { FUND_BY_CATEGORY, type FundId } from '../../../shared/funds';
import type { CategoryId } from '../../../shared/categories';
import { TABLE } from '../config';
import type { Tagged } from '../ddb';
import { badRequest, conflict } from '../errors';
import { fundKey, periodKeys, txKeys, ym } from '../keys';
import type { TransactionItem } from '../types';
import type { FundDelta } from './funds';
import {
  optionalFundId,
  optionalString,
  requireAmount,
  requireCategoryId,
  requireDate,
  requireString,
} from '../validate';

export interface TxInput {
  id?: string;
  td: string;
  nm: string;
  cat: CategoryId;
  amt: number;
  src?: FundId;
  memo: string;
}

export function parseTxInput(body: Record<string, unknown>): TxInput {
  const td = requireDate(body.td, 'td');
  const nm = requireString(body.nm, 'nm', 200);
  const cat = requireCategoryId(body.cat);
  const amt = requireAmount(body.amt, 'amt'); // 0 and negatives are valid
  const src = optionalFundId(body.src);
  const memo = optionalString(body.memo, 'memo', 500);

  // Spending a fund's money on that same fund's category is meaningless.
  if (src && FUND_BY_CATEGORY[cat] === src) {
    throw badRequest('VALIDATION', `a fund cannot fund itself: ${cat} deposits into ${src}`);
  }

  const id = body.id === undefined || body.id === null ? undefined : String(body.id);
  return { id, td, nm, cat, amt, src, memo };
}

export function toItem(input: TxInput, ts: number): TransactionItem {
  const item: TransactionItem = {
    ...txKeys(input.td, ts),
    td: input.td,
    nm: input.nm,
    cat: input.cat,
    amt: input.amt,
    type: 'TRANSACTION',
  };
  if (input.src) item.src = input.src;
  if (input.memo) item.memo = input.memo;
  return item;
}

/**
 * Compare-and-swap on the prior item. Pins exactly the three attributes the fund
 * delta was computed from, so an edit that raced our read cancels the whole
 * transaction instead of applying a reversal of the wrong number.
 *
 * `td` needs no pin — it is encoded in the key being addressed.
 */
export function pinCondition(old: TransactionItem) {
  const names: Record<string, string> = { '#amt': 'amt', '#cat': 'cat', '#src': 'src' };
  const values: Record<string, unknown> = { ':oAmt': old.amt, ':oCat': old.cat };
  let expr = 'attribute_exists(PK) AND #amt = :oAmt AND #cat = :oCat AND ';
  if (old.src) {
    expr += '#src = :oSrc';
    values[':oSrc'] = old.src;
  } else {
    expr += 'attribute_not_exists(#src)';
  }
  return { expr, names, values };
}

/**
 * `SET #t = if_not_exists(#t, :ft)` is required: on the first write of a new year the
 * Fund item does not exist, and ADD alone would create it without a `type` attribute
 * — invisible to every read path, which splits items on `type`.
 *
 * The condition is chosen by the sign of the balance delta, not by deposit-vs-
 * withdrawal: `amt` is signed, so a deposit can lower a balance too.
 */
export function fundUpdate(d: FundDelta): Tagged {
  const values: Record<string, unknown> = {
    ':ft': 'FUND',
    ':dbal': d.bal,
    ':ddep': d.dep,
    ':dwd': d.wd,
  };
  const update: Record<string, unknown> = {
    TableName: TABLE,
    Key: fundKey(d.fund, d.year),
    UpdateExpression: 'SET #t = if_not_exists(#t, :ft) ADD #bal :dbal, #dep :ddep, #wd :dwd',
    ExpressionAttributeNames: { '#t': 'type', '#bal': 'bal', '#dep': 'dep', '#wd': 'wd' },
    ExpressionAttributeValues: values,
  };
  if (d.bal < 0) {
    update.ConditionExpression = '#bal >= :decrease';
    values[':decrease'] = -d.bal;
  }
  return {
    item: { Update: update } as Tagged['item'],
    onFail: conflict(
      'FUND_OVERDRAW',
      `${d.fund} has insufficient balance for ${d.year}`,
      { fund: d.fund, year: d.year, requested: -d.bal },
    ),
  };
}

/**
 * A Transaction may only be filed into a month that already has a Period. `getMonth`
 * 404s on a month with no Period item, so a transaction written into one would be
 * invisible everywhere except the year rollup.
 *
 * A ConditionCheck rather than a preceding read: it is atomic with the write, costs no
 * extra round trip, and `transactWrite` maps the failure back by index. Only the *new*
 * month is checked — an edit's old month must already have had a Period for the
 * original write to have succeeded.
 *
 * The Period item is `MONTH#<ym> / MONTH#<ym>` while the Transaction is
 * `MONTH#<ym> / DAY#<dd>#TS#<ts>`, so the two never address the same key and the
 * transaction stays legal.
 */
export function periodExists(td: string): Tagged {
  const yearMonth = ym(td);
  const { PK, SK } = periodKeys(yearMonth);
  return {
    item: {
      ConditionCheck: {
        TableName: TABLE,
        Key: { PK, SK },
        ConditionExpression: 'attribute_exists(PK)',
      },
    } as Tagged['item'],
    onFail: conflict('NO_PERIOD', `no period exists for ${yearMonth}; create it first`, {
      yearMonth,
    }),
  };
}

/**
 * Create: a single conditional Put.
 * Update, key unchanged: a pinned Put (replacing the whole item, so dropping `src`
 *   or `memo` happens for free).
 * Update, key changed: a pinned Delete of the old key plus a Put of the new one.
 *
 * The rekey trigger is `old.td !== new.td`, not "the month changed": SK contains
 * DAY#<dd>, so a same-month day edit also moves the item. Emitting a bare Put there
 * would leave the original behind as a duplicate.
 */
export function buildTxTransactItems(
  old: TransactionItem | null,
  newItem: TransactionItem,
  deltas: FundDelta[],
): Tagged[] {
  const items: Tagged[] = [periodExists(newItem.td)];
  const created: Tagged = {
    item: { Put: { TableName: TABLE, Item: newItem, ConditionExpression: 'attribute_not_exists(PK)' } },
    onFail: conflict('TS_COLLISION', 'a transaction already exists at this key'),
  };

  if (old === null) {
    items.push(created);
  } else {
    const pin = pinCondition(old);
    const rekey = old.PK !== newItem.PK || old.SK !== newItem.SK;
    const onFail = conflict(
      'CONCURRENT_MODIFICATION',
      'the transaction changed since it was read; reload and retry',
    );

    if (rekey) {
      items.push({
        item: {
          Delete: {
            TableName: TABLE,
            Key: { PK: old.PK, SK: old.SK },
            ConditionExpression: pin.expr,
            ExpressionAttributeNames: pin.names,
            ExpressionAttributeValues: pin.values,
          },
        },
        onFail,
      });
      items.push(created);
    } else {
      items.push({
        item: {
          Put: {
            TableName: TABLE,
            Item: newItem,
            ConditionExpression: pin.expr,
            ExpressionAttributeNames: pin.names,
            ExpressionAttributeValues: pin.values,
          },
        },
        onFail,
      });
    }
  }

  return [...items, ...deltas.map(fundUpdate)];
}
