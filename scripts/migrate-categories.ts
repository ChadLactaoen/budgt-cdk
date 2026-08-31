import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);

const SOURCE_TABLE = 'Category';
const TARGET_TABLE = 'Budgt';

interface SourceCategory {
  name: string;
  parent: string;
  color: string;
  deprecated?: boolean;
}

interface TargetCategory {
  PK: string;
  SK: string;
  parentCategory: string;
  subCategory: string;
  color: string;
  entityType: string;
  active: boolean;
}

function transform(source: SourceCategory): TargetCategory {
  return {
    PK: 'GLOBAL#',
    SK: `CAT#${source.parent}#SUB#${source.name}`,
    parentCategory: source.parent,
    subCategory: source.name,
    color: source.color,
    entityType: 'Category',
    active: source.deprecated !== true,
  };
}

async function migrate() {
  // Scan all items from source table
  const scanResult = await docClient.send(new ScanCommand({
    TableName: SOURCE_TABLE,
  }));

  const items = scanResult.Items as SourceCategory[];
  console.log(`Found ${items.length} categories to migrate`);

  // Transform items
  const transformed = items.map(transform);

  // Log sample transformation
  console.log('\nSample transformation:');
  console.log('Source:', JSON.stringify(items[0], null, 2));
  console.log('Target:', JSON.stringify(transformed[0], null, 2));

  // Batch write in chunks of 25 (DynamoDB limit)
  const chunks: TargetCategory[][] = [];
  for (let i = 0; i < transformed.length; i += 25) {
    chunks.push(transformed.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [TARGET_TABLE]: chunk.map(item => ({
          PutRequest: { Item: item },
        })),
      },
    }));
    console.log(`Migrated ${chunk.length} items`);
  }

  console.log('\nMigration complete!');
  console.log(`Total migrated: ${transformed.length} categories`);
  console.log(`Active: ${transformed.filter(c => c.active).length}`);
  console.log(`Inactive: ${transformed.filter(c => !c.active).length}`);
}

migrate().catch(console.error);
