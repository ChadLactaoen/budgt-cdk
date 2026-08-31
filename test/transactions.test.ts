import { buildTxTransactItems } from '../lambda/api/domain/transactions';
import { txKeys } from '../lambda/api/keys';
import type { TransactionItem } from '../lambda/api/types';

const tx = (td: string, ts: number, over: Partial<TransactionItem> = {}): TransactionItem => ({
  ...txKeys(td, ts),
  td,
  nm: 'Cinemark Theatres',
  cat: 'MISC_OTHER',
  amt: 2500,
  type: 'TRANSACTION',
  ...over,
});

/** The `Tagged` item kind, for asserting on shape without repeating the union. */
const kind = (t: { item: Record<string, unknown> }) => Object.keys(t.item)[0];

describe('buildTxTransactItems', () => {
  describe('period gate', () => {
    it('checks the period on a create, ahead of the write', () => {
      const items = buildTxTransactItems(null, tx('2026-08-07', 1000), []);

      expect(kind(items[0])).toBe('ConditionCheck');
      const check = (items[0].item as any).ConditionCheck;
      expect(check.Key).toEqual({ PK: 'MONTH#2026-08', SK: 'MONTH#2026-08' });
      expect(check.ConditionExpression).toBe('attribute_exists(PK)');
      expect(items[0].onFail.code).toBe('NO_PERIOD');
      expect(items[0].onFail.status).toBe(409);
    });

    it('checks only the new month when a date edit moves the item', () => {
      const items = buildTxTransactItems(
        tx('2026-08-07', 1000),
        tx('2026-09-03', 1000),
        [],
      );

      const checks = items.filter((i) => kind(i) === 'ConditionCheck');
      expect(checks).toHaveLength(1);
      expect((checks[0].item as any).ConditionCheck.Key.PK).toBe('MONTH#2026-09');
    });

    it('addresses a different key than the transaction itself', () => {
      // Two operations on the same key would make the whole transaction illegal.
      const items = buildTxTransactItems(null, tx('2026-08-07', 1000), []);
      const check = (items[0].item as any).ConditionCheck.Key;
      const put = (items[1].item as any).Put.Item;

      expect(check.PK).toBe(put.PK);
      expect(check.SK).not.toBe(put.SK);
    });
  });

  describe('write shape', () => {
    it('creates with a single conditional Put', () => {
      const items = buildTxTransactItems(null, tx('2026-08-07', 1000), []);

      expect(items.map(kind)).toEqual(['ConditionCheck', 'Put']);
      expect((items[1].item as any).Put.ConditionExpression).toBe('attribute_not_exists(PK)');
      expect(items[1].onFail.code).toBe('TS_COLLISION');
    });

    it('updates in place with one pinned Put when the key is unchanged', () => {
      const items = buildTxTransactItems(
        tx('2026-08-07', 1000),
        tx('2026-08-07', 1000, { amt: 3000 }),
        [],
      );

      expect(items.map(kind)).toEqual(['ConditionCheck', 'Put']);
      expect((items[1].item as any).Put.ConditionExpression).toContain('#amt = :oAmt');
      expect(items[1].onFail.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('rekeys with a pinned Delete plus a Put when the day changes within a month', () => {
      const items = buildTxTransactItems(
        tx('2026-08-07', 1000),
        tx('2026-08-09', 1000),
        [],
      );

      expect(items.map(kind)).toEqual(['ConditionCheck', 'Delete', 'Put']);
      expect((items[1].item as any).Delete.Key).toEqual({
        PK: 'MONTH#2026-08',
        SK: 'DAY#07#TS#1000',
      });
      expect((items[2].item as any).Put.Item.SK).toBe('DAY#09#TS#1000');
    });
  });
});
