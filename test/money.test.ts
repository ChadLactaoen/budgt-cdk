import { parseAmountExpression, parseDollarsToCents } from '../shared/money';

describe('parseAmountExpression', () => {
  test('a lone term parses exactly as parseDollarsToCents does', () => {
    for (const input of ['26.99', '$1,199', '0', '-20.00', '.5', 'abc', '', '-', '1.234']) {
      expect(parseAmountExpression(input)).toBe(parseDollarsToCents(input));
    }
  });

  test('sums two terms', () => {
    // The motivating case: one purchase, two card charges.
    expect(parseAmountExpression('68.95+19.98')).toBe(8893);
  });

  test('sums three terms', () => {
    expect(parseAmountExpression('10+20+0.05')).toBe(3005);
  });

  test('whitespace around the operator is not meaningful', () => {
    expect(parseAmountExpression('68.95 + 19.98')).toBe(8893);
    expect(parseAmountExpression('  68.95+19.98  ')).toBe(8893);
  });

  test('currency and thousands separators survive the split', () => {
    expect(parseAmountExpression('$1,199+$0.01')).toBe(119901);
  });

  test('a leading minus makes the first term a refund', () => {
    expect(parseAmountExpression('-20.00+5.00')).toBe(-1500);
  });

  test('a half-typed expression is not an amount', () => {
    // Reading "68.95+" as $68.95 would save a wrong total the moment the user pauses.
    expect(parseAmountExpression('68.95+')).toBeNull();
    expect(parseAmountExpression('+19.98')).toBeNull();
    expect(parseAmountExpression('+')).toBeNull();
    expect(parseAmountExpression('68.95++19.98')).toBeNull();
  });

  test('one malformed term poisons the whole expression', () => {
    expect(parseAmountExpression('68.95+1.234')).toBeNull();
    expect(parseAmountExpression('68.95+abc')).toBeNull();
  });

  test('the result is always an exact integer number of cents', () => {
    const total = parseAmountExpression('0.1+0.2');
    expect(total).toBe(30);
    expect(Number.isSafeInteger(total)).toBe(true);
  });
});
