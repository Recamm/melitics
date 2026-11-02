import { buyboxObservationSchema, buyboxSummarySchema, currencySchema, marketplaceIdSchema, offerSnapshotSchema, paymentSegmentSchema,
  type BuyboxObservation, type BuyboxSummary, type Money, type OfferSnapshot, type PaymentSegment } from '../../shared/contracts';

export type OfferGroup = { key: string; segment: PaymentSegment; comparable: boolean; offers: OfferSnapshot[]; minimum: Money | null; minimumListingIds: string[]; winnerListingIds: string[] };

export function paymentSegment(offer: OfferSnapshot): PaymentSegment {
  if (!offer.installments.count || offer.installments.interest === 'unknown') return 'unknown';
  return offer.installments.count === 1 ? 'direct' : offer.installments.interest === 'interest-free' ? 'installments-interest-free' : 'installments-with-interest';
}

export function compareOffers(input: OfferSnapshot[], productId: string): OfferGroup[] {
  marketplaceIdSchema.parse(productId);
  if (input.length > 500) throw new Error('Too many offers');
  const latest = new Map<string, OfferSnapshot>();
  for (const value of input) {
    const offer = offerSnapshotSchema.parse(value);
    if (offer.productId !== productId) throw new Error('Catalog mismatch');
    const previous = latest.get(offer.listingId);
    if (previous && previous.source.observedAt === offer.source.observedAt && JSON.stringify(previous) !== JSON.stringify(offer)) throw new Error('Conflicting observation');
    if (!previous || offer.source.observedAt > previous.source.observedAt) latest.set(offer.listingId, offer);
  }
  const groups = new Map<string, OfferGroup>();
  for (const offer of latest.values()) {
    const segment = paymentSegment(offer);
    const comparable = !!offer.price && segment !== 'unknown' && offer.shipping.full !== null && offer.shipping.free !== null
      && (offer.shipping.free || offer.shipping.cost !== null) && (offer.installments.count === 1 || offer.installments.total !== null);
    const key = comparable ? JSON.stringify([productId, offer.price?.currency, segment, offer.installments.count, offer.shipping.full, offer.shipping.free, offer.shipping.cost?.amountMinor ?? 0, offer.source.observedAt.slice(0, 10)]) : `unknown:${offer.listingId}`;
    const group = groups.get(key) ?? { key, segment, comparable, offers: [], minimum: null, minimumListingIds: [], winnerListingIds: [] };
    group.offers.push(offer);
    if (offer.winner === true) group.winnerListingIds.push(offer.listingId);
    const payable = offer.installments.total ?? offer.price;
    if (comparable && payable) {
      if (!group.minimum || payable.amountMinor < group.minimum.amountMinor) { group.minimum = payable; group.minimumListingIds = [offer.listingId]; }
      else if (payable.amountMinor === group.minimum.amountMinor) group.minimumListingIds.push(offer.listingId);
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, offers: group.offers.toSorted((left, right) =>
    (left.installments.total?.amountMinor ?? left.price?.amountMinor ?? Number.MAX_SAFE_INTEGER) - (right.installments.total?.amountMinor ?? right.price?.amountMinor ?? Number.MAX_SAFE_INTEGER)) }));
}

export function summarizeBuybox(input: BuyboxObservation[], options: { productId: string; listingId: string; currency: Money['currency']; segment: Exclude<PaymentSegment, 'unknown'>; days: 7 | 30 | 90; now?: Date }): BuyboxSummary {
  marketplaceIdSchema.parse(options.productId); marketplaceIdSchema.parse(options.listingId); currencySchema.parse(options.currency);
  if (paymentSegmentSchema.parse(options.segment) === 'unknown') throw new Error('Unknown payment segment');
  const now = options.now ?? new Date();
  if (input.length > 50000 || ![7, 30, 90].includes(options.days) || !Number.isFinite(now.getTime())) throw new Error('Invalid observation window');
  const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (options.days - 1) * 86400000;
  const observations = new Map<string, BuyboxObservation>();
  for (const value of input) {
    const observation = buyboxObservationSchema.parse(value); const time = Date.parse(observation.source.observedAt);
    if (observation.productId !== options.productId || observation.currency !== options.currency || observation.segment !== options.segment || time < cutoff || time > now.getTime()) continue;
    const previous = observations.get(observation.source.observedAt);
    observations.set(observation.source.observedAt, previous && previous.winnerListingId !== observation.winnerListingId ? { ...observation, winnerListingId: null } : observation);
  }
  const ordered = [...observations.values()].toSorted((left, right) => left.source.observedAt.localeCompare(right.source.observedAt));
  const known = ordered.filter(observation => observation.winnerListingId !== null);
  const wins = known.filter(observation => observation.winnerListingId === options.listingId).length;
  return buyboxSummarySchema.parse({ knownSamples: known.length, unknownSamples: ordered.length - known.length, wins,
    winBps: known.length ? Math.round(wins * 10000 / known.length) : null,
    firstAt: ordered[0]?.source.observedAt ?? null, lastAt: ordered.at(-1)?.source.observedAt ?? null,
    observedDays: new Set(ordered.map(observation => observation.source.observedAt.slice(0, 10))).size, periodDays: options.days });
}