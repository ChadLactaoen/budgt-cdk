import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE } from '../config';
import { doc } from '../ddb';
import { json } from '../http';
import { TEMPLATE_PK } from '../keys';
import type { TemplateItem } from '../types';

/** Access pattern 6. */
export async function getTemplates() {
  const result = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': TEMPLATE_PK },
    }),
  );

  const templates = ((result.Items ?? []) as TemplateItem[]).map((t) => ({
    id: t.SK,
    tn: t.tn ?? t.nm,
    nm: t.nm,
    amt: t.amt,
    cat: t.cat,
    active: t.active !== false,
  }));

  return json(200, { templates });
}
