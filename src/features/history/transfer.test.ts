import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { historyArchiveSchema, observationId, publicationKey, type HistoryArchive, type PublicPageSnapshot } from '../../shared/contracts';
import { exportHistory, importHistory } from './transfer';

function archive(title = '=HYPERLINK("https://example.test")\n"Prueba, propia"'): HistoryArchive {
  const snapshot: PublicPageSnapshot = {
    siteId: 'MLA', locale: 'es-AR', kind: 'listing', listingId: 'MLA123456789', productId: null,
    canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-123456789-prueba', title,
    price: { amountMinor: Number.MAX_SAFE_INTEGER, currency: 'ARS', exponent: 2 },
    imageUrl: null, seller: null, observedAt: '2026-11-01T12:00:00.000Z', extractorRevision: 'public-v1', provenance: {},
  };
  return historyArchiveSchema.parse({ schemaVersion: 1, exportedAt: '2026-11-01T13:00:00.000Z',
    publications: [{ key: publicationKey(snapshot), snapshot, following: true, followedAt: snapshot.observedAt }],
    observations: [{ id: observationId(snapshot), publicationKey: publicationKey(snapshot), snapshot }],
  });
}

describe('versioned history transfers', () => {
  it.each(['json', 'csv'] as const)('roundtrips %s without losing quotes, newlines or exact minor amounts', format => {
    const value = archive(); expect(importHistory(exportHistory(value, format), format)).toEqual(value);
    const empty = { ...value, publications: [], observations: [] };
    expect(importHistory(exportHistory(empty, format), format)).toEqual(empty);
  });

  it.each(['=SUM(A1)', '+cmd', '-cmd', '@SUM(A1)', '\t=1', '\n=1', "'texto"])('exports spreadsheet-safe titles: %j', title => {
    const csv = exportHistory(archive(title), 'csv');
    const rows = Papa.parse<Record<string, string>>(csv, { header: true }).data;
    expect(rows.find(row => row.recordType === 'publication')?.title).toBe(`'${title}`);
    expect(importHistory(csv, 'csv').publications[0]?.snapshot.title).toBe(title);
  });

  it('rejects unknown versions, extra private fields, broken CSV and inconsistent identities', () => {
    const value = archive();
    for (const invalid of [ { ...value, schemaVersion: 99 }, { ...value, orders: [] },
      { ...value, observations: [{ ...value.observations[0], id: 'forged-id' }] } ]) {
      expect(() => importHistory(JSON.stringify(invalid), 'json')).toThrow();
    }
    expect(() => importHistory('schemaVersion,recordType\r\n1,"unterminated', 'csv')).toThrow();
  });

  it('retains separate currencies and duplicate identities for the transactional merge to resolve', () => {
    const value = archive(); const original = value.observations[0]!;
    const changed = { ...original.snapshot, price: { amountMinor: 100, currency: 'USD' as const, exponent: 2 } };
    value.observations.push(original, { id: observationId(changed), publicationKey: publicationKey(changed), snapshot: changed });
    expect(importHistory(exportHistory(value, 'csv'), 'csv').observations).toHaveLength(3);
  });
});