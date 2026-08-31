import type { APIGatewayProxyEvent } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { FUNDS, type FundId } from '../../../shared/funds';
import { TABLE, YEAR_QUERY_LIMIT } from '../config';
import { doc } from '../ddb';
import { json, pathParam } from '../http';
import { fundKey, yearGsiPk } from '../keys';
import type { FundItem, PeriodItem, TransactionItem } from '../types';
import { requireYear } from '../validate';
import { toTransactionResponse } from './getMonth';

/**
 * Access pattern 4. One GSI1 query returns both Periods and Transactions for the
 * year: `MONTH#08` sorts immediately before `MONTH#08#DAY#...`, so each Period
 * arrives directly ahead of its own transactions. Split on `type`.
 *
 * Raw rows are returned and rolled up client-side, since the client already holds
 * category metadata and caches the result.
 */
export async function getYear(event: APIGatewayProxyEvent) {
  const year = requireYear(pathParam(event, 'year'));

  const [yearResult, ...fundResults] = await Promise.all([
    doc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': yearGsiPk(year) },
        Limit: YEAR_QUERY_LIMIT,
      }),
    ),
    ...(Object.keys(FUNDS) as FundId[]).map((fund) =>
      doc.send(new GetCommand({ TableName: TABLE, Key: fundKey(fund, year) })),
    ),
  ]);

  const items = yearResult.Items ?? [];
  const periods = (items.filter((i) => i.type === 'PERIOD') as PeriodItem[]).map((p) => ({
    yearMonth: p.SK.slice('MONTH#'.length),
    amt: p.amt,
    memo: p.memo ?? '',
  }));
  const transactions = (items.filter((i) => i.type === 'TRANSACTION') as TransactionItem[]).map(
    toTransactionResponse,
  );

  const funds = (Object.keys(FUNDS) as FundId[]).map((fund, i) => {
    const item = fundResults[i]?.Item as FundItem | undefined;
    return { id: fund, bal: item?.bal ?? 0, dep: item?.dep ?? 0, wd: item?.wd ?? 0 };
  });

  return json(200, {
    year,
    periods,
    transactions,
    funds,
    // The client must surface this rather than render an under-reported year.
    truncated: Boolean(yearResult.LastEvaluatedKey),
  });
}
