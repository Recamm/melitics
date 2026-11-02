import { describe, expect, it } from 'vitest';
import type { PublicPageSnapshot } from '../../shared/contracts';
import { contactCandidate, contactsForSeller } from './contacts';

function snapshot(sellerId: string): PublicPageSnapshot {
  return { siteId: 'MLA', locale: 'es-AR', kind: 'listing', listingId: 'MLA123456789', productId: null,
    canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-123456789-prueba', title: 'Prueba', price: null, imageUrl: null,
    seller: { id: sellerId, name: 'Fixture', url: `https://www.mercadolibre.com.ar/perfil/TIENDA_${sellerId}` },
    observedAt: '2026-11-01T12:00:00.000Z', extractorRevision: 'public-v1', provenance: {} };
}

describe('public seller contacts without identity assumptions', () => {
  it('captures only a public profile with seller ID, provenance and an explicit expiration', () => {
    expect(contactCandidate(snapshot('98765'))).toMatchObject({ sellerId: '98765', field: 'profile', verification: 'unconfirmed',
      observedAt: '2026-11-01T12:00:00.000Z', expiresAt: '2026-12-01T12:00:00.000Z', sourceUrl: snapshot('98765').canonicalUrl });
  });

  it('does not carry contacts from seller A to seller B and keeps expired contacts distinguishable', () => {
    const first = contactCandidate(snapshot('98765')); const second = contactCandidate(snapshot('12345'));
    expect(contactsForSeller([first, second], '12345', new Date('2026-11-02T00:00:00Z'))).toHaveLength(1);
    expect(contactsForSeller([first], '98765', new Date('2026-12-02T00:00:00Z'))).toMatchObject([{ expired: true }]);
  });

  it('refuses script URLs, private routes and profiles without a public seller ID', () => {
    const value = snapshot('98765');
    expect(contactCandidate({ ...value, seller: { ...value.seller!, url: 'javascript:alert(1)' } })).toBeNull();
    expect(contactCandidate({ ...value, seller: { ...value.seller!, id: null } })).toBeNull();
    expect(contactCandidate({ ...value, seller: { ...value.seller!, url: 'https://www.mercadolibre.com.ar/my-account/orders' } })).toBeNull();
  });
});