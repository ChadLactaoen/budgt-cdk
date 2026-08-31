import type { APIGatewayProxyEvent } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE } from '../config';
import { doc, transactWrite } from '../ddb';
import { ApiError, badRequest, notFound } from '../errors';
import { json, readJsonBody } from '../http';
import { formatTxId, parseTxId, txKeys } from '../keys';
import type { TransactionItem } from '../types';
import { fundDelta, type TxLike } from '../domain/funds';
import { buildTxTransactItems, parseTxInput, toItem, type TxInput } from '../domain/transactions';

export async function postTransactions(event: APIGatewayProxyEvent) {
  const input = parseTxInput(readJsonBody(event));
  const old = input.id === undefined ? null : await readExisting(input.id);
  const ts = old ? tsOf(old) : Date.now();

  try {
    return await write(input, old, ts);
  } catch (e) {
    // A same-millisecond create collision. Fund deltas do not depend on `ts`, so
    // only the key changes on retry.
    if (old === null && e instanceof ApiError && e.code === 'TS_COLLISION') {
      return await write(input, null, ts + 1);
    }
    throw e;
  }
}

async function write(input: TxInput, old: TransactionItem | null, ts: number) {
  const newItem = toItem(input, ts);
  const deltas = fundDelta(old ? toTxLike(old) : null, toTxLike(newItem));
  await transactWrite(buildTxTransactItems(old, newItem, deltas));

  return json(200, {
    // May differ from the id supplied: `td` is editable and the id encodes it.
    id: formatTxId(input.td, ts),
    td: input.td,
    nm: input.nm,
    cat: input.cat,
    amt: input.amt,
    ...(input.src ? { src: input.src } : {}),
    memo: input.memo,
  });
}

/**
 * ConsistentRead is required, not defensive. Fund balances are maintained by ADD,
 * which applies a relative change and never recomputes from source — so a stale read
 * of the prior amount produces a reversal of the wrong number, and the resulting
 * error is permanent.
 */
async function readExisting(id: string): Promise<TransactionItem> {
  const parsed = parseTxId(id);
  if (!parsed) throw badRequest('VALIDATION', `malformed transaction id: ${id}`);

  const keys = txKeys(parsed.td, parsed.ts);
  const result = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: keys.PK, SK: keys.SK },
      ConsistentRead: true,
    }),
  );
  if (!result.Item) throw notFound(`no transaction ${id}`);
  return result.Item as TransactionItem;
}

const tsOf = (t: TransactionItem) => Number(t.SK.slice(t.SK.lastIndexOf('#') + 1));

const toTxLike = (t: TransactionItem): TxLike => ({
  td: t.td,
  cat: t.cat,
  amt: t.amt,
  src: t.src,
});
