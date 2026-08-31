import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);

const SOURCE_TABLE = 'Template';
const TARGET_TABLE = 'Budgt';

interface SourceTemplate {
  templateName: string;
  type: string;
  category: string;
  name: string;
  price: number;
}

interface TargetTemplate {
  PK: string;
  SK: string;
  templateId: string;
  name: string;
  category: string;
  defaultAmount: number;
  entityType: string;
}

function toSlug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function toCents(price: number): number {
  return Math.round(price * 100);
}

function transform(source: SourceTemplate): TargetTemplate {
  return {
    PK: 'GLOBAL#',
    SK: `TPL#${source.templateName}`,
    templateId: toSlug(source.templateName),
    name: source.name,
    category: source.category,
    defaultAmount: toCents(source.price),
    entityType: 'Template',
  };
}

async function migrate() {
  // Scan all items from source table, filtering out BET type
  const scanResult = await docClient.send(new ScanCommand({
    TableName: SOURCE_TABLE,
    FilterExpression: '#t = :type',
    ExpressionAttributeNames: { '#t': 'type' },
    ExpressionAttributeValues: { ':type': 'TRANSACTION' },
  }));

  const items = scanResult.Items as SourceTemplate[];
  console.log(`Found ${items.length} templates to migrate (filtered out BET items)`);

  // Transform items
  const transformed = items.map(transform);

  // Log sample transformation
  console.log('\nSample transformation:');
  console.log('Source:', JSON.stringify(items[0], null, 2));
  console.log('Target:', JSON.stringify(transformed[0], null, 2));

  // Batch write in chunks of 25 (DynamoDB limit)
  const chunks: TargetTemplate[][] = [];
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
  console.log(`Total migrated: ${transformed.length} templates`);
}

migrate().catch(console.error);
