import type { APIGatewayProxyEvent } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE } from '../config';
import { doc, transactWrite } from '../ddb';
import { json, readJsonBody } from '../http';
import { monthPk } from '../keys';
import { buildPeriodTransactItems, parsePeriodInput } from '../domain/periods';

/**
 * Upsert — 404 is unreachable here, since a month that does not exist is simply
 * created. The allocation array is a full replacement, not a delta.
 */
export async function postPeriods(event: APIGatewayProxyEvent) {
  const input = parsePeriodInput(readJsonBody(event));
  const existingSks = await readExistingAllocationSks(input.yearMonth);
  await transactWrite(buildPeriodTransactItems(input, existingSks));

  return json(200, {
    yearMonth: input.yearMonth,
    amt: input.amt,
    memo: input.memo,
    allocations: input.allocations,
  });
}

/**
 * ConsistentRead is required: an eventually-consistent read taken shortly after a
 * previous save can miss a just-written allocation, which then survives the "full
 * replacement" as an orphan and silently breaks sum(allocations) === Period.amt.
 */
async function readExistingAllocationSks(yearMonth: string): Promise<string[]> {
  const sks: string[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': monthPk(yearMonth), ':sk': 'CAT#' },
        ProjectionExpression: 'SK',
        ConsistentRead: true,
        ExclusiveStartKey,
      }),
    );
    for (const item of result.Items ?? []) sks.push(item.SK as string);
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return sks;
}
