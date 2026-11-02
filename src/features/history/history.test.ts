import { describe, expect, it } from 'vitest';
import { observationId, publicationKey, type Money, type PriceObservation, type PublicPageSnapshot } from '../../shared/contracts';
import { historyChartPoints, summarizeHistory } from './history';

function capture(day: number, amount: number | null, currency: Money['currency'] = 'ARS'): PriceObservation {
  const snapshot: PublicPageSnapshot = {
    siteId: 'MLA', locale: 'es-AR', kind: 'listing', listingId: 'MLA123456789', productId: null,
    canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-123456789-prueba',
    title: 'Prueba', price: amount === null ? null : { amountMinor: amount, currency, exponent: currency === 'CLP' ? 0 : 2 },
    imageUrl: null, seller: null, observedAt: `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    extractorRevision: 'public-v1', provenance: {},
  };
  return { id: observationId(snapshot), publicationKey: publicationKey(snapshot), snapshot };
}

describe('observed history without inferred prices', () => {
  it('breaks chart lines on unavailable prices, changed currency and days without coverage', () => {
    const points = historyChartPoints([capture(2, 100), capture(5, 200), capture(6, 100, 'USD'), capture(7, null)], 'ARS');
    expect(points.map(point => point[1])).toEqual([1, null, 2, null, null]);
    expect(points[1]?.[0]).toBe(Date.parse('2026-11-03T12:00:00Z'));
  });

  it('sorts UTC captures, isolates currencies and keeps explicit missing-price observations', () => {
    const input = [capture(7, 800), capture(6, null), capture(5, 500, 'USD'), capture(2, 1000), capture(1, 300)];
    const result = summarizeHistory(input, 7, 'ARS', new Date('2026-11-08T00:00:00Z'));
    expect(result.observations.map(item => item.snapshot.observedAt.slice(8, 10))).toEqual(['02', '05', '06', '07']);
    expect(result.currencies).toEqual(['ARS', 'USD']);
    expect(result.minimum?.amountMinor).toBe(800); expect(result.maximum?.amountMinor).toBe(1000);
    expect(result.change?.amountMinor).toBe(-200); expect(result.changeBps).toBe(-2000);
    expect(result.observedDays).toBe(4); expect(result.missingDays).toBe(3);
  });

  it('does not invent prices or a historical change with fewer than two prices', () => {
    const result = summarizeHistory([capture(7, null), capture(6, 100)], 30, 'USD', new Date('2026-11-08T00:00:00Z'));
    expect(result.minimum).toBeNull(); expect(result.change).toBeNull();
    expect(result.observations).toHaveLength(2); expect(result.missingDays).toBe(28);
    expect(summarizeHistory([capture(7, 100)], 7, 'ARS', new Date('2026-11-08T00:00:00Z')).change).toBeNull();
  });

  it('preserves exact signed cents and refuses a percentage with a zero starting price', () => {
    const now = new Date('2026-11-08T00:00:00Z');
    expect(summarizeHistory([capture(6, Number.MAX_SAFE_INTEGER), capture(7, Number.MAX_SAFE_INTEGER - 1)], 7, 'ARS', now).change?.amountMinor).toBe(-1);
    expect(summarizeHistory([capture(6, 0), capture(7, 10)], 7, 'ARS', now).changeBps).toBeNull();
  });

  it('excludes future snapshots and rejects invalid periods', () => {
    expect(summarizeHistory([capture(9, 100)], 7, 'ARS', new Date('2026-11-08T00:00:00Z')).observations).toEqual([]);
    expect(() => summarizeHistory([], 8 as 7, 'ARS')).toThrow();
  });
});