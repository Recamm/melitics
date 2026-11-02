import { describe, expect, it } from 'vitest';
import { offerSnapshotSchema, type BuyboxObservation, type OfferSnapshot } from '../../shared/contracts';
import { compareOffers, summarizeBuybox } from './catalog';

const productId = 'MLA111111111';
function offer(listingId: string, amountMinor: number, winner: boolean | null = null): OfferSnapshot {
  return { siteId: 'MLA', productId, listingId, sellerId: '98765', sellerName: 'Fixture',
    price: { amountMinor, currency: 'ARS', exponent: 2 }, installments: { count: 1, interest: 'interest-free', total: null },
    shipping: { full: false, free: true, cost: null }, winner,
    source: { kind: 'public-page', url: `https://www.mercadolibre.com.ar/p/${productId}`, observedAt: '2026-11-01T12:00:00.000Z' } };
}

describe('comparable public catalog observations', () => {
  it('does not compare offers captured on different UTC dates', () => {
    const current = offer('MLA123456789', 12000, true);
    const old = { ...offer('MLA987654321', 8000), source: { ...current.source, observedAt: '2026-10-31T12:00:00Z' } };
    expect(compareOffers([current, old], productId)).toHaveLength(2);
  });

  it('distinguishes the observed winner from the cheaper comparable listing', () => {
    const groups = compareOffers([offer('MLA123456789', 12000, true), offer('MLA987654321', 10000, false)], productId);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ comparable: true, minimumListingIds: ['MLA987654321'], winnerListingIds: ['MLA123456789'], minimum: { amountMinor: 10000 } });
  });

  it('isolates currencies, installments, fulfillment and unknown conditions', () => {
    const direct = offer('MLA123456789', 10000);
    const unknown = { ...offer('MLA987654321', 8000), shipping: { full: null, free: null, cost: null } };
    const credit = { ...offer('MLA234567890', 11000), installments: { count: 3, interest: 'interest-free' as const, total: { amountMinor: 11000, currency: 'ARS' as const, exponent: 2 } } };
    const groups = compareOffers([direct, unknown, credit], productId);
    expect(groups).toHaveLength(3);
    expect(groups.find(group => group.offers[0]?.listingId === unknown.listingId)).toMatchObject({ comparable: false, minimum: null, minimumListingIds: [] });
    expect(groups.find(group => group.offers[0]?.listingId === credit.listingId)?.segment).toBe('installments-interest-free');
  });

  it('keeps only the latest offer per listing without changing the input', () => {
    const older = offer('MLA123456789', 9000); const latest = { ...older, price: { ...older.price!, amountMinor: 10000 }, source: { ...older.source, observedAt: '2026-11-01T13:00:00.000Z' } };
    expect(compareOffers([latest, older], productId)[0]?.offers).toHaveLength(1);
    expect(compareOffers([latest, older], productId)[0]?.minimum?.amountMinor).toBe(10000);
    expect(older.price?.amountMinor).toBe(9000);
  });

  it('computes capture percentage per segment and excludes unknown winners from the denominator', () => {
    const base: BuyboxObservation = { siteId: 'MLA', productId, currency: 'ARS', segment: 'direct', winnerListingId: 'MLA123456789', source: offer('MLA123456789', 10000).source };
    const observations = [base, { ...base, winnerListingId: null, source: { ...base.source, observedAt: '2026-11-01T13:00:00.000Z' } },
      { ...base, winnerListingId: 'MLA987654321', source: { ...base.source, observedAt: '2026-11-01T14:00:00.000Z' } },
      { ...base, segment: 'installments-interest-free' as const, source: { ...base.source, observedAt: '2026-11-01T15:00:00.000Z' } }];
    expect(summarizeBuybox(observations, { productId, listingId: 'MLA123456789', currency: 'ARS', segment: 'direct', days: 7, now: new Date('2026-11-01T18:00:00Z') }))
      .toMatchObject({ knownSamples: 2, unknownSamples: 1, wins: 1, winBps: 5000, observedDays: 1 });
    expect(summarizeBuybox(observations, { productId, listingId: 'MLA123456789', currency: 'ARS', segment: 'installments-interest-free', days: 7, now: new Date('2026-11-01T18:00:00Z') }))
      .toMatchObject({ knownSamples: 1, unknownSamples: 0, winBps: 10000 });
  });

  it('does not manufacture a percentage from only unknown winners', () => {
    const observation: BuyboxObservation = { siteId: 'MLA', productId, currency: 'ARS', segment: 'direct', winnerListingId: null, source: offer('MLA123456789', 10000).source };
    expect(summarizeBuybox([observation], { productId, listingId: 'MLA123456789', currency: 'ARS', segment: 'direct', days: 30, now: new Date('2026-11-01T18:00:00Z') }))
      .toMatchObject({ knownSamples: 0, unknownSamples: 1, winBps: null });
  });

  it('rejects unsafe or private source URLs and contradictory monetary conditions', () => {
    const input = offer('MLA123456789', 10000);
    expect(offerSnapshotSchema.safeParse({ ...input, source: { ...input.source, url: 'javascript:alert(1)' } }).success).toBe(false);
    expect(offerSnapshotSchema.safeParse({ ...input, shipping: { full: true, free: true, cost: { amountMinor: 100, currency: 'USD', exponent: 2 } } }).success).toBe(false);
  });
});