import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { ApiError, conflict } from './errors';

/**
 * `removeUndefinedValues` keeps optional attributes (`src`, `memo`) from throwing
 * when absent. Items are still built conditionally rather than relying on it, so a
 * typo'd attribute name is not silently swallowed.
 */
export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/** A transaction item paired with the error to raise if its condition fails. */
export interface Tagged {
  item: TransactItem;
  onFail: ApiError;
}

/**
 * Several items in one transaction may carry a ConditionExpression, and all of them
 * surface identically as `ConditionalCheckFailed`. `CancellationReasons` is index
 * aligned with `TransactItems`, so the position is what distinguishes an overdraw
 * from a concurrent edit.
 */
export async function transactWrite(tagged: Tagged[]): Promise<void> {
  try {
    await doc.send(new TransactWriteCommand({ TransactItems: tagged.map((t) => t.item) }));
  } catch (e) {
    const err = e as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
    if (err.name === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons ?? [];
      for (let i = 0; i < reasons.length; i++) {
        const code = reasons[i]?.Code;
        if (code === 'ConditionalCheckFailed' && tagged[i]) throw tagged[i].onFail;
        if (code === 'TransactionConflict') {
          throw conflict('CONCURRENT_MODIFICATION', 'another write touched these items; retry');
        }
      }
    }
    throw e;
  }
}
