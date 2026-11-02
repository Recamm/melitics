import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money';

const argentina = { currency: 'ARS', locale: 'es-AR', format: 'localized' as const };

describe('exact monetary display', () => {
  it.each([
    [1, '$\u00a00,01'], [-1, '-$\u00a00,01'], [-123456, '-$\u00a01.234,56'],
    [Number.MAX_SAFE_INTEGER, '$\u00a090.071.992.547.409,91'],
  ])('formats %s minor units without rounding away cents or a loss sign', (amountMinor, expected) => {
    expect(formatMoney({ amountMinor, currency: 'ARS', exponent: 2 })).toBe(expected);
  });
  it('formats a zero-decimal currency without adding fictitious cents', () => {
    expect(formatMoney({ amountMinor: -1234, currency: 'CLP', exponent: 0 })).toBe('-CLP\u00a01.234');
  });
});

describe('money normalization', () => {
  it.each([
    ['1.234,56', argentina, { amountMinor: 123456, currency: 'ARS', exponent: 2 }],
    ['1.234,56', { currency: 'BRL', locale: 'pt-BR', format: 'localized' as const }, { amountMinor: 123456, currency: 'BRL', exponent: 2 }],
    ['1.234', { currency: 'CLP', locale: 'es-CL', format: 'localized' as const }, { amountMinor: 1234, currency: 'CLP', exponent: 0 }],
    ['1,234.56', { currency: 'USD', locale: 'en-US', format: 'localized' as const }, { amountMinor: 123456, currency: 'USD', exponent: 2 }],
    ['1234,5', argentina, { amountMinor: 123450, currency: 'ARS', exponent: 2 }],
    ['0', argentina, { amountMinor: 0, currency: 'ARS', exponent: 2 }],
    [' 12,34 ', argentina, { amountMinor: 1234, currency: 'ARS', exponent: 2 }],
  ])('normalizes localized %j with an explicit currency and locale', (value, options, expected) => {
    expect(parseMoney(value, options)).toEqual(expected);
  });

  it.each(['1234.56', 1234.56])('does not interpret a JSON-LD price as locale-formatted: %j', (value) => {
    expect(parseMoney(value, { ...argentina, format: 'machine' })).toEqual({
      amountMinor: 123456, currency: 'ARS', exponent: 2,
    });
  });

  it('handles the safe integer boundary without floating-point rounding', () => {
    expect(parseMoney('90071992547409.91', { ...argentina, format: 'machine' }))
      .toEqual({ amountMinor: Number.MAX_SAFE_INTEGER, currency: 'ARS', exponent: 2 });
    expect(parseMoney('90071992547409.92', { ...argentina, format: 'machine' })).toBeNull();
  });

  it.each([
    null, undefined, '', ' ', NaN, Infinity, -1, '-1,00', '+1,00',
    '1,234', '1.234,567', '1.23,45', '1,234.56', '12.34',
    '1e3', 'ARS 123', '$ 123', '123abc', {}, [], '900719925474099999999999',
  ])('rejects absent, ambiguous or unsafe localized input: %j', (value) => {
    expect(parseMoney(value, argentina)).toBeNull();
  });

  it.each(['1.234', '1,234', '1e3', '-1', Number.NaN, 0.1 + 0.2])(
    'rejects machine prices with invalid syntax or excess precision: %j', (value) => {
      expect(parseMoney(value, { ...argentina, format: 'machine' })).toBeNull();
    },
  );

  it('rejects fractional pesos for a zero-decimal currency', () => {
    expect(parseMoney('1234.50', { currency: 'CLP', locale: 'es-CL', format: 'machine' })).toBeNull();
    expect(parseMoney('1.234,50', { currency: 'CLP', locale: 'es-CL', format: 'localized' })).toBeNull();
  });

  it('rejects unsupported currency or locale rather than assuming an exponent', () => {
    expect(parseMoney('123', { ...argentina, currency: 'UNKNOWN' })).toBeNull();
    expect(parseMoney('123', { ...argentina, locale: 'not a locale' })).toBeNull();
  });
});