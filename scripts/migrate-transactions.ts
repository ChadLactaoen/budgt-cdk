import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);

const SOURCE_TABLE = 'Transaction';
const TARGET_TABLE = 'Budgt';

interface SourceTransaction {
  transactionId: string;
  effectivePeriod: string;
  effectiveYear: string;
  date: string;
  name: string;
  price: number;
  category: {
    name: string;
    parent: string;
    color: string;
  };
}

interface TargetTransaction {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  transactionId: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  subCategory: string;
  entityType: string;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function transform(source: SourceTransaction): TargetTransaction {
  const month = source.effectivePeriod.split('-')[1]; // Extract MM from YYYY-MM

  return {
    PK: `MONTH#${source.effectivePeriod}`,
    SK: `TXN#${source.transactionId}`,
    GSI1PK: `YEAR#${source.effectiveYear}`,
    GSI1SK: `MONTH#${month}#TXN#${source.transactionId}`,
    transactionId: source.transactionId,
    date: source.date,
    name: source.name,
    amount: toCents(source.price),
    category: source.category.parent,
    subCategory: source.category.name,
    entityType: 'Transaction',
  };
}

function isValidTransaction(item: Partial<SourceTransaction>): item is SourceTransaction {
  return !!(
    item.transactionId &&
    item.effectivePeriod &&
    item.effectiveYear &&
    item.date &&
    item.name &&
    item.price !== undefined &&
    item.category
  );
}

async function migrate() {
  // Scan all items from source table with pagination
  let rawItems: Partial<SourceTransaction>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  console.log('Scanning source table...');
  do {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: SOURCE_TABLE,
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    rawItems = rawItems.concat(scanResult.Items as Partial<SourceTransaction>[]);
    lastEvaluatedKey = scanResult.LastEvaluatedKey;
    console.log(`Scanned ${rawItems.length} items so far...`);
  } while (lastEvaluatedKey);

  // Filter out incomplete transactions
  const items = rawItems.filter(isValidTransaction);
  const skipped = rawItems.length - items.length;

  console.log(`\nFound ${rawItems.length} total transactions`);
  console.log(`Skipping ${skipped} incomplete transactions`);
  console.log(`Migrating ${items.length} valid transactions`);

  // Transform items
  const transformed = items.map(transform);

  // Log sample transformation
  console.log('\nSample transformation:');
  console.log('Source:', JSON.stringify(items[0], null, 2));
  console.log('Target:', JSON.stringify(transformed[0], null, 2));

  // Batch write in chunks of 25 (DynamoDB limit)
  const chunks: TargetTransaction[][] = [];
  for (let i = 0; i < transformed.length; i += 25) {
    chunks.push(transformed.slice(i, i + 25));
  }

  let migratedCount = 0;
  for (const chunk of chunks) {
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [TARGET_TABLE]: chunk.map(item => ({
          PutRequest: { Item: item },
        })),
      },
    }));
    migratedCount += chunk.length;
    if (migratedCount % 1000 === 0 || migratedCount === transformed.length) {
      console.log(`Migrated ${migratedCount}/${transformed.length} items`);
    }
  }

  console.log('\nMigration complete!');
  console.log(`Total migrated: ${transformed.length} transactions`);
}

migrate().catch(console.error);
