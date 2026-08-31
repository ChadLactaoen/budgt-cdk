export const TABLE = process.env.TABLE_NAME ?? 'Budgt';

/** Safety bound on the year query. Well above ~50 transactions/month + 12 periods. */
export const YEAR_QUERY_LIMIT = 1000;

/** DynamoDB's hard cap on a single TransactWriteItems call. */
export const TRANSACT_ITEM_LIMIT = 100;
