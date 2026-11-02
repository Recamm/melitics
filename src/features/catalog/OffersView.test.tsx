import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { OfferSnapshot, PublicPageSnapshot } from '../../shared/contracts';
import { OffersView } from './OffersView';
afterEach(cleanup);
const snapshot: PublicPageSnapshot = { siteId: 'MLA', locale: 'es-AR', kind: 'catalog', listingId: 'MLA123456789', productId: 'MLA111111111', canonicalUrl: 'https://www.mercadolibre.com.ar/p/MLA111111111', title: 'Fixture', price: null, imageUrl: null, seller: null, observedAt: '2026-11-01T12:00:00.000Z', extractorRevision: 'public-v1', provenance: {} };
describe('honest catalog interface', () => {
  it('shows unavailable offers and Buybox without inventing a winner or sample', async () => {
    render(<OffersView snapshot={snapshot} />);
    await screen.findByText('Sin fuente autorizada');
    expect(screen.queryByRole('table')).toBeNull(); expect(document.body.textContent).not.toContain('100 %');
  });
  it('renders observed winner independently from the comparable minimum', () => {
    const base: OfferSnapshot = { siteId: 'MLA', productId: 'MLA111111111', listingId: 'MLA123456789', sellerId: '98765', sellerName: 'Fixture caro',
      price: { amountMinor: 12000, currency: 'ARS', exponent: 2 }, installments: { count: 1, interest: 'interest-free', total: null }, shipping: { full: false, free: true, cost: null }, winner: true,
      source: { kind: 'authorized-api', url: snapshot.canonicalUrl, observedAt: snapshot.observedAt } };
    render(<OffersView snapshot={snapshot} result={{ status: 'ready', sourceId: 'fixture-only', offers: [base, { ...base, listingId: 'MLA987654321', sellerName: 'Fixture barato', price: { amountMinor: 10000, currency: 'ARS', exponent: 2 }, winner: false }], buybox: [] }} />);
    const table = screen.getByRole('table', { name: 'Ofertas observadas' });
    expect(table.textContent).toContain('Ganador observado'); expect(table.textContent).toContain('M\u00ednimo comparable');
    expect(screen.getByText('Sin capturas con ganador conocido')).toBeTruthy();
  });
});