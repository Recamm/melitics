import { currencySchema, priceObservationSchema, type Money, type PriceObservation, type SignedMoney } from '../../shared/contracts';

export interface HistorySummary {
  observations: PriceObservation[];
  currencies: Money['currency'][];
  minimum: Money | null;
  maximum: Money | null;
  change: SignedMoney | null;
  changeBps: number | null;
  observedDays: number;
  missingDays: number;
}

export function historyChartPoints(observations: PriceObservation[], currency: Money['currency']): [number, number | null][] {
  const points: [number, number | null][] = [];
  for (const observation of observations.toSorted((left, right) => left.snapshot.observedAt.localeCompare(right.snapshot.observedAt))) {
    const time = Date.parse(observation.snapshot.observedAt);
    const previous = points.at(-1);
    if (previous && time - previous[0] > 86400000) points.push([previous[0] + 86400000, null]);
    const price = observation.snapshot.price;
    points.push([time, price?.currency === currency ? price.amountMinor / 10 ** price.exponent : null]);
  }
  return points;
}

export function summarizeHistory(input: PriceObservation[], days: 7 | 30 | 90, currency: Money['currency'], now = new Date()): HistorySummary {
  if (![7, 30, 90].includes(days) || !Number.isFinite(now.getTime()) || input.length > 50000) throw new Error('Invalid history period');
  currencySchema.parse(currency);
  const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86400000;
  const observations = input.map(item => priceObservationSchema.parse(item))
    .filter(item => Date.parse(item.snapshot.observedAt) >= cutoff && Date.parse(item.snapshot.observedAt) <= now.getTime())
    .sort((left, right) => left.snapshot.observedAt.localeCompare(right.snapshot.observedAt));
  const currencies = [...new Set(observations.flatMap(item => item.snapshot.price ? [item.snapshot.price.currency] : []))].sort();
  const prices = observations.flatMap(item => item.snapshot.price?.currency === currency ? [item.snapshot.price] : []);
  const minimum = prices.reduce<Money | null>((current, price) => !current || price.amountMinor < current.amountMinor ? price : current, null);
  const maximum = prices.reduce<Money | null>((current, price) => !current || price.amountMinor > current.amountMinor ? price : current, null);
  const first = prices[0]; const last = prices.at(-1);
  const change = prices.length >= 2 && first && last ? { ...last, amountMinor: last.amountMinor - first.amountMinor } : null;
  const ratio = change && first?.amountMinor ? BigInt(change.amountMinor) * 10000n / BigInt(first.amountMinor) : null;
  const changeBps = ratio !== null && ratio <= BigInt(Number.MAX_SAFE_INTEGER) && ratio >= BigInt(-Number.MAX_SAFE_INTEGER) ? Number(ratio) : null;
  const observedDays = new Set(observations.map(item => item.snapshot.observedAt.slice(0, 10))).size;
  return { observations, currencies, minimum, maximum, change, changeBps, observedDays, missingDays: days - observedDays };
}