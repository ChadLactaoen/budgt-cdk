import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);

const SOURCE_TABLE = 'Period';
const TARGET_TABLE = 'Budgt';

interface SourceAllocation {
  count: number;
  total: number;
  category: {
    name: string;
    parent: string;
    color: string;
  };
}

interface SourcePeriod {
  startDate: string;
  total: number;
  notes?: string;
  allocations: SourceAllocation[];
}

interface TargetPeriod {
  PK: string;
  SK: string;
  total: number;
  notes?: string;
  entityType: string;
}

interface TargetAllocation {
  PK: string;
  SK: string;
  parentCategory: string;
  subCategory: string;
  budgetedAmount: number;
  entityType: string;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function transformPeriod(source: SourcePeriod): TargetPeriod {
  const period: TargetPeriod = {
    PK: `MONTH#${source.startDate}`,
    SK: 'METADATA#',
    total: toCents(source.total),
    entityType: 'Period',
  };

  if (source.notes) {
    period.notes = source.notes;
  }

  return period;
}

function transformAllocations(source: SourcePeriod): TargetAllocation[] {
  return source.allocations.map(alloc => ({
    PK: `MONTH#${source.startDate}`,
    SK: `CAT#${alloc.category.parent}#SUB#${alloc.category.name}`,
    parentCategory: alloc.category.parent,
    subCategory: alloc.category.name,
    budgetedAmount: toCents(alloc.total),
    entityType: 'Allocation',
  }));
}

async function migrate() {
  // Scan all items from source table
  let items: SourcePeriod[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: SOURCE_TABLE,
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    items = items.concat(scanResult.Items as SourcePeriod[]);
    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Found ${items.length} periods to migrate`);

  // Transform items
  const periods = items.map(transformPeriod);
  const allocations = items.flatMap(transformAllocations);

  console.log(`Will create ${periods.length} Period entities`);
  console.log(`Will create ${allocations.length} Allocation entities`);

  // Log sample transformations
  console.log('\nSample Period transformation:');
  console.log('Source startDate:', items[0].startDate);
  console.log('Target:', JSON.stringify(periods[0], null, 2));

  console.log('\nSample Allocation transformation:');
  console.log('Source allocation:', JSON.stringify(items[0].allocations[0], null, 2));
  console.log('Target:', JSON.stringify(allocations[0], null, 2));

  // Combine all items to write
  const allItems = [...periods, ...allocations];

  // Batch write in chunks of 25 (DynamoDB limit)
  const chunks: (TargetPeriod | TargetAllocation)[][] = [];
  for (let i = 0; i < allItems.length; i += 25) {
    chunks.push(allItems.slice(i, i + 25));
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
    if (migratedCount % 500 === 0 || migratedCount === allItems.length) {
      console.log(`Migrated ${migratedCount}/${allItems.length} items`);
    }
  }

  console.log('\nMigration complete!');
  console.log(`Total Period entities: ${periods.length}`);
  console.log(`Total Allocation entities: ${allocations.length}`);
}

migrate().catch(console.error);
