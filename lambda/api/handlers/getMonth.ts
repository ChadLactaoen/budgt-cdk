import type { APIGatewayProxyEvent } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { FUNDS, type FundId } from '../../../shared/funds';
import { TABLE } from '../config';
import { doc } from '../ddb';
import { notFound } from '../errors';
import { json, pathParam } from '../http';
import { formatTxId, fundKey, monthPk } from '../keys';
import type { AllocationItem, FundItem, PeriodItem, TransactionItem } from '../types';
import { requireYearMonth } from '../validate';

/**
 * Access patterns 1 and 5. The month partition and the fund items live in different
 * partitions, so the reads run concurrently. Fund balances are folded into this
 * response rather than exposed as their own endpoint.
 */
export async function getMonth(event: APIGatewayProxyEvent) {
  const yearMonth = requireYearMonth(pathParam(event, 'yearMonth'));
  const year = yearMonth.slice(0, 4);

  const [monthResult, ...fundResults] = await Promise.all([
    doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': monthPk(yearMonth) },
      }),
    ),
    ...(Object.keys(FUNDS) as FundId[]).map((fund) =>
      doc.send(new GetCommand({ TableName: TABLE, Key: fundKey(fund, year) })),
    ),
  ]);

  const items = monthResult.Items ?? [];
  const period = items.find((i) => i.type === 'PERIOD') as PeriodItem | undefined;
  if (!period) throw notFound(`no period for ${yearMonth}`);

  const allocations = (items.filter((i) => i.type === 'ALLOCATION') as AllocationItem[]).map(
    (a) => ({ cat: a.cat, amt: a.amt }),
  );
  const transactions = (items.filter((i) => i.type === 'TRANSACTION') as TransactionItem[]).map(
    toTransactionResponse,
  );

  const funds = (Object.keys(FUNDS) as FundId[]).map((fund, i) => {
    const item = fundResults[i]?.Item as FundItem | undefined;
    return { id: fund, bal: item?.bal ?? 0, dep: item?.dep ?? 0, wd: item?.wd ?? 0 };
  });

  return json(200, {
    period: { yearMonth, amt: period.amt, memo: period.memo ?? '' },
    allocations,
    transactions,
    funds,
  });
}

export function toTransactionResponse(t: TransactionItem) {
  const ts = Number(t.SK.slice(t.SK.lastIndexOf('#') + 1));
  return {
    id: formatTxId(t.td, ts),
    td: t.td,
    nm: t.nm,
    cat: t.cat,
    amt: t.amt,
    ...(t.src ? { src: t.src } : {}),
    memo: t.memo ?? '',
  };
}
