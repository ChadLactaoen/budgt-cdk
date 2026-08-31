import type { APIGatewayProxyEvent } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE } from '../config';
import { doc } from '../ddb';
import { badRequest, notFound } from '../errors';
import { json, pathParam } from '../http';
import { parseTxId, txKeys } from '../keys';
import type { TransactionItem } from '../types';
import { toTransactionResponse } from './getMonth';

/** Access pattern 3. The composite id carries everything needed to build PK and SK. */
export async function getTransaction(event: APIGatewayProxyEvent) {
  const id = pathParam(event, 'id');
  const parsed = parseTxId(id);
  if (!parsed) throw badRequest('VALIDATION', `malformed transaction id: ${id}`);

  const keys = txKeys(parsed.td, parsed.ts);
  const result = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { PK: keys.PK, SK: keys.SK } }),
  );
  if (!result.Item) throw notFound(`no transaction ${id}`);

  return json(200, toTransactionResponse(result.Item as TransactionItem));
}
