import { describe, expect, it } from 'vitest';
import { CURRENCY_EXPONENTS, FEE_FIELDS, feeResultSchema, type FeeScenario, type Money } from '../../shared/contracts';
import { calculateProfitability } from './calculate';

function money(amountMinor: number, currency: Money['currency'] = 'ARS'): Money {
  return { amountMinor, currency, exponent: CURRENCY_EXPONENTS[currency] };
}

function scenario(): FeeScenario {
  return {
    currency: 'ARS' as const,
    price: money(10000), cost: money(4000), commissionBps: 1000,
    fixedFee: money(200), shipping: money(500), taxes: money(300), financing: money(0),
    rules: { source: 'manual' as const, version: 'manual-half-up-v1' as const, observedAt: '2026-11-01T12:00:00.000Z' },
  };
}

describe('manual profitability', () => {
  it.each(FEE_FIELDS)('does not invent a net amount when %s is missing', (field) => {
    const result = calculateProfitability({ ...scenario(), [field]: null });
    expect(result).toEqual({ status: 'incomplete', missing: [field], rules: scenario().rules });
    expect(result).not.toHaveProperty('payout');
    expect(result).not.toHaveProperty('profit');
  });

  it('does not divide by zero sale price or cost', () => {
    expect(calculateProfitability({ ...scenario(), price: money(0) })).toMatchObject({
      status: 'complete', payout: money(-1000), profit: money(-5000), marginBps: null, breakEven: money(5556),
    });
    expect(calculateProfitability({ ...scenario(), cost: money(0) })).toMatchObject({
      status: 'complete', profit: money(8000), marginBps: 8000, returnOnCostBps: null,
    });
  });

  it('keeps losses and negative margins instead of clamping them to zero', () => {
    expect(calculateProfitability({ ...scenario(), cost: money(9000) })).toMatchObject({
      status: 'complete', profit: money(-1000), marginBps: -1000, returnOnCostBps: -1111,
    });
  });

  it.each([10000, 12000])('keeps a valid negative payout but no break-even for rate %s', (rate) => {
    const result = calculateProfitability({ ...scenario(), commissionBps: rate });
    expect(result).toMatchObject({ status: 'complete', breakEven: null });
    if (result.status !== 'complete') throw new Error('Expected a complete scenario');
    expect(result.payout.amountMinor).toBeLessThan(0);
    expect(result.marginBps).toBeLessThan(0);
  });

  it.each(['ARS', 'BRL', 'CLP', 'USD'] as const)('rounds each charge half-up in minor units for %s', (currency) => {
    const result = calculateProfitability({
      ...scenario(), currency, price: money(1, currency), cost: money(0, currency), commissionBps: 5000,
      fixedFee: money(0, currency), shipping: money(0, currency), taxes: money(0, currency), financing: money(0, currency),
    });
    expect(result).toMatchObject({ status: 'complete', commission: money(1, currency), profit: money(0, currency) });
    expect(feeResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([0, 3000, 5000, 9999])('finds the smallest break-even under integer rounding for rate %s', (rate) => {
    const input = { ...scenario(), commissionBps: rate, cost: money(1), fixedFee: money(0), shipping: money(0), taxes: money(0), financing: money(0) };
    const result = calculateProfitability(input);
    if (result.status !== 'complete' || !result.breakEven) throw new Error('Expected break-even');
    const at = calculateProfitability({ ...input, price: result.breakEven });
    const before = calculateProfitability({ ...input, price: money(result.breakEven.amountMinor - 1) });
    if (at.status !== 'complete' || before.status !== 'complete') throw new Error('Expected complete boundary scenarios');
    expect(at.profit.amountMinor).toBeGreaterThanOrEqual(0);
    expect(before.profit.amountMinor).toBeLessThan(0);
  });

  it.each([-1, 1.5, NaN, Infinity, 1000001])('rejects invalid basis points %s', (rate) => {
    expect(calculateProfitability({ ...scenario(), commissionBps: rate })).toEqual({ status: 'invalid', reason: 'invalid-scenario' });
  });

  it('rejects mixed currency, incorrect exponent, negative charges and unrecognized data', () => {
    for (const input of [
      { ...scenario(), taxes: money(1, 'USD') },
      { ...scenario(), cost: { ...money(1), exponent: 0 } },
      { ...scenario(), shipping: money(-1) },
      { ...scenario(), buyerId: 'private-fixture' },
    ]) expect(calculateProfitability(input)).toEqual({ status: 'invalid', reason: 'invalid-scenario' });
  });

  it('handles safe boundaries without floating-point multiplication and rejects overflow', () => {
    const input = { ...scenario(), price: money(Number.MAX_SAFE_INTEGER), cost: money(0), commissionBps: 5000,
      fixedFee: money(0), shipping: money(0), taxes: money(0), financing: money(0) };
    expect(calculateProfitability(input)).toMatchObject({ status: 'complete', commission: money(4503599627370496), payout: money(4503599627370495) });
    expect(calculateProfitability({ ...input, commissionBps: 20000 })).toEqual({ status: 'invalid', reason: 'overflow' });
    expect(calculateProfitability({ ...scenario(), cost: money(Number.MAX_SAFE_INTEGER), fixedFee: money(Number.MAX_SAFE_INTEGER) })).toEqual({ status: 'invalid', reason: 'overflow' });
  });

  it('does not lose valid net amounts when a ratio or break-even exceeds the safe range', () => {
    const result = calculateProfitability({ ...scenario(), price: money(1), cost: money(Number.MAX_SAFE_INTEGER),
      commissionBps: 9999, fixedFee: money(0), shipping: money(0), taxes: money(0), financing: money(0) });
    expect(result).toMatchObject({ status: 'complete', profit: money(-Number.MAX_SAFE_INTEGER), marginBps: null, breakEven: null });
  });

  it('preserves rule provenance, does not mutate inputs and emits only JSON-safe contracts', () => {
    const input = scenario();
    const previous = JSON.stringify(input);
    const result = calculateProfitability(input);
    expect(JSON.stringify(input)).toBe(previous);
    expect(feeResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it('reproduces the plan scenario and separates payout, profit, margin and return on cost', () => {
    expect(calculateProfitability(scenario())).toMatchObject({
      status: 'complete', commission: money(1000), deductions: money(2000),
      payout: money(8000), profit: money(4000), marginBps: 4000, returnOnCostBps: 10000,
      breakEven: money(5556), rules: scenario().rules,
    });
  });
});