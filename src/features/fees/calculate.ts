import { CURRENCY_EXPONENTS, FEE_FIELDS, feeScenarioSchema, type FeeResult, type FeeScenario } from '../../shared/contracts';

const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
const RATE_SCALE = 10000n;

function safeInteger(value: bigint): number | null {
  return value >= -MAX_AMOUNT && value <= MAX_AMOUNT ? Number(value) : null;
}

function roundHalfUp(value: bigint, divisor: bigint): bigint {
  const absolute = value < 0n ? -value : value;
  const rounded = (absolute + divisor / 2n) / divisor;
  return value < 0n ? -rounded : rounded;
}

export function calculateProfitability(scenario: FeeScenario): FeeResult {
  const parsed = feeScenarioSchema.safeParse(scenario);
  if (!parsed.success) return { status: 'invalid', reason: 'invalid-scenario' };
  const input = parsed.data;
  const missing = FEE_FIELDS.filter((field) => input[field] === null);
  if (missing.length) return { status: 'incomplete', missing, rules: input.rules };
  const price = BigInt(input.price!.amountMinor);
  const cost = BigInt(input.cost!.amountMinor);
  const rate = BigInt(input.commissionBps!);
  const fixedCharges = BigInt(input.fixedFee!.amountMinor) + BigInt(input.shipping!.amountMinor)
    + BigInt(input.taxes!.amountMinor) + BigInt(input.financing!.amountMinor);
  const commission = roundHalfUp(price * rate, RATE_SCALE);
  const deductions = commission + fixedCharges;
  const payout = price - deductions;
  const profit = payout - cost;
  if ([commission, deductions, payout, profit].some((value) => safeInteger(value) === null)) {
    return { status: 'invalid', reason: 'overflow' };
  }
  const amount = (value: bigint) => ({ amountMinor: Number(value), currency: input.currency, exponent: CURRENCY_EXPONENTS[input.currency] });
  const threshold = (fixedCharges + cost) * RATE_SCALE - RATE_SCALE / 2n;
  const breakEven = rate >= RATE_SCALE ? null : threshold < 0n ? 0n : threshold / (RATE_SCALE - rate) + 1n;
  return {
    status: 'complete',
    commission: amount(commission), deductions: amount(deductions), payout: amount(payout), profit: amount(profit),
    marginBps: price === 0n ? null : safeInteger(roundHalfUp(profit * RATE_SCALE, price)),
    returnOnCostBps: cost === 0n ? null : safeInteger(roundHalfUp(profit * RATE_SCALE, cost)),
    breakEven: breakEven === null || safeInteger(breakEven) === null ? null : amount(breakEven),
    rules: input.rules,
  };
}