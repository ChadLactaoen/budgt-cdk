import { effect, fundDelta, type TxLike } from '../lambda/api/domain/funds';

const RD = 'FUND#RAINY_DAY' as const;

/** A deposit: the fund's own category, no funding source. */
const dep = (amt: number, td = '2026-08-01'): TxLike => ({ td, cat: 'SAV_RAINY_DAY', amt });
/** A withdrawal: filed under its real category, paid from the fund. */
const wd = (amt: number, td = '2026-08-09'): TxLike => ({ td, cat: 'MISC_OTHER', amt, src: RD });
/** No fund involvement. */
const plain = (amt: number, td = '2026-08-07'): TxLike => ({ td, cat: 'ESS_GROCERIES', amt });

const only = (deltas: ReturnType<typeof fundDelta>) => {
  expect(deltas).toHaveLength(1);
  return deltas[0];
};

describe('effect', () => {
  test('src wins over a fund-backed cat', () => {
    // A transaction that is somehow both is a withdrawal: the funding source is what
    // defines one. (The self-referential case is rejected at validation.)
    const e = effect({ td: '2026-08-01', cat: 'SAV_RAINY_DAY', amt: 100, src: RD });
    expect(e).toMatchObject({ bal: -100, dep: 0, wd: 100 });
  });

  test('a plain transaction has no effect', () => {
    expect(effect(plain(5000))).toBeNull();
  });

  test('bal always equals dep minus wd', () => {
    for (const tx of [dep(7500), wd(5000), dep(-100), wd(-200)]) {
      const e = effect(tx)!;
      expect(e.bal).toBe(e.dep - e.wd);
    }
  });
});

describe('fundDelta', () => {
  test('create with no fund involvement emits nothing', () => {
    expect(fundDelta(null, plain(5000))).toEqual([]);
  });

  test('create deposit credits the fund', () => {
    expect(only(fundDelta(null, dep(7500)))).toMatchObject({ fund: RD, year: '2026', bal: 7500, dep: 7500, wd: 0 });
  });

  test('create withdrawal debits the fund', () => {
    expect(only(fundDelta(null, wd(5000)))).toMatchObject({ bal: -5000, dep: 0, wd: 5000 });
  });

  test.each([
    ['deposit raised', dep(7500), dep(9000), { bal: 1500, dep: 1500, wd: 0 }],
    ['deposit lowered', dep(9000), dep(7500), { bal: -1500, dep: -1500, wd: 0 }],
    ['withdrawal raised', wd(5000), wd(6000), { bal: -1000, dep: 0, wd: 1000 }],
    ['withdrawal lowered', wd(6000), wd(4000), { bal: 2000, dep: 0, wd: -2000 }],
    ['deposit becomes withdrawal', dep(7500), wd(5000), { bal: -12500, dep: -7500, wd: 5000 }],
    ['withdrawal becomes deposit', wd(5000), dep(5000), { bal: 10000, dep: 5000, wd: -5000 }],
    ['withdrawal loses its src', wd(5000), plain(5000), { bal: 5000, dep: 0, wd: -5000 }],
    ['plain gains a src', plain(5000), { ...plain(5000), src: RD }, { bal: -5000, dep: 0, wd: 5000 }],
  ])('%s', (_label, before, after, expected) => {
    expect(only(fundDelta(before, after))).toMatchObject(expected);
  });

  test('a metadata-only edit emits nothing', () => {
    expect(fundDelta(wd(5000), wd(5000))).toEqual([]);
  });

  test('moving months within a year emits nothing: funds are keyed by year', () => {
    expect(fundDelta(wd(5000, '2026-08-31'), wd(5000, '2026-09-01'))).toEqual([]);
  });

  describe('crossing a year touches two fund items', () => {
    test('withdrawal', () => {
      const deltas = fundDelta(wd(5000, '2025-12-31'), wd(5000, '2026-01-02'));
      expect(deltas).toHaveLength(2);
      expect(deltas.find((d) => d.year === '2025')).toMatchObject({ bal: 5000, wd: -5000 });
      expect(deltas.find((d) => d.year === '2026')).toMatchObject({ bal: -5000, wd: 5000 });
    });

    test('deposit', () => {
      const deltas = fundDelta(dep(7500, '2025-12-30'), dep(7500, '2026-01-03'));
      expect(deltas).toHaveLength(2);
      expect(deltas.find((d) => d.year === '2025')).toMatchObject({ bal: -7500, dep: -7500 });
      expect(deltas.find((d) => d.year === '2026')).toMatchObject({ bal: 7500, dep: 7500 });
    });
  });

  // Deletes are intentionally unsupported; corrections zero out the amount instead.
  describe('zeroing out fully reverses the effect', () => {
    test('a withdrawal', () => {
      expect(only(fundDelta(wd(5000), wd(0)))).toMatchObject({ bal: 5000, dep: 0, wd: -5000 });
    });

    test('a deposit', () => {
      // Note this LOWERS the balance, so it carries the overdraw condition and can
      // legitimately 409 if the money has already been spent.
      expect(only(fundDelta(dep(7500), dep(0)))).toMatchObject({ bal: -7500, dep: -7500 });
    });
  });

  // amt is signed, so deposit-vs-withdrawal does not predict the sign of the balance
  // change — which is why the overdraw condition keys off the delta, not the kind.
  test('a negative deposit lowers the balance', () => {
    expect(only(fundDelta(null, dep(-1000))).bal).toBeLessThan(0);
  });

  test('a negative withdrawal raises the balance', () => {
    expect(only(fundDelta(null, wd(-2000))).bal).toBeGreaterThan(0);
  });

  test('at most two deltas are ever emitted', () => {
    expect(fundDelta(wd(1, '2024-01-01'), dep(2, '2026-01-01')).length).toBeLessThanOrEqual(2);
  });
});
