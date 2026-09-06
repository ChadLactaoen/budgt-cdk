/**
 * The AWS half of the legacy migration: one document client, and the three operations
 * both scripts need. Split from `mapping.ts` so the transforms stay runnable without
 * credentials.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

export const REGION = 'us-west-2';
export const TARGET_TABLE = 'Budgt';

/**
 * The one partition this migration must never touch: it holds live data entered through
 * the app. Legacy stops at 2026-08, so nothing maps here — the guard is for the day
 * someone re-points a SOURCE_TABLE.
 */
export const PROTECTED_PKS = new Set(['MONTH#2026-09']);

const client = new DynamoDBClient({ region: REGION });
export const doc = DynamoDBDocumentClient.from(client);

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** BatchWrite silently returns what it did not write; retrying is not optional. */
export async function batchWrite(requests: Array<Record<string, unknown>>) {
  for (const group of chunk(requests, 25)) {
    let pending = group;
    for (let attempt = 0; pending.length && attempt < 8; attempt++) {
      const res = await doc.send(new BatchWriteCommand({ RequestItems: { [TARGET_TABLE]: pending } }));
      pending = (res.UnprocessedItems?.[TARGET_TABLE] ?? []) as typeof pending;
      if (pending.length) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
    if (pending.length) throw new Error(`${pending.length} items never written`);
  }
}

export async function scanAll<T>(table: string): Promise<T[]> {
  const out: T[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(new ScanCommand({ TableName: table, ExclusiveStartKey: start }));
    out.push(...((res.Items ?? []) as T[]));
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}

export type Key = { PK: string; SK: string };

/** Every key in one partition, so a re-run can replace it wholesale. */
export async function partitionKeys(pk: string): Promise<Key[]> {
  const keys: Key[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TARGET_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: start,
      }),
    );
    for (const item of res.Items ?? []) keys.push({ PK: String(item.PK), SK: String(item.SK) });
    start = res.LastEvaluatedKey;
  } while (start);
  return keys;
}

/**
 * Clearing before writing is what makes a re-run idempotent even when the mapping has
 * changed underneath it — a stale key from a previous run would otherwise survive as a
 * duplicate that nothing points at.
 */
export async function clearPartitions(pks: string[], keep: (k: Key) => boolean = () => false) {
  assertNotProtected(pks);
  const keys: Key[] = [];
  for (const pk of pks) keys.push(...(await partitionKeys(pk)).filter((k) => !keep(k)));
  if (keys.length) await batchWrite(keys.map((Key) => ({ DeleteRequest: { Key } })));
  return keys.length;
}

export function assertNotProtected(pks: string[]) {
  const hit = pks.filter((pk) => PROTECTED_PKS.has(pk));
  if (hit.length) throw new Error(`refusing to write protected partition(s): ${hit.join(', ')}`);
}

/** Both scripts default to a dry run; writing takes an explicit --apply. */
export const APPLY = process.argv.includes('--apply');
