import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { extractPublicPage } from './extract';

const listingUrl = 'https://articulo.mercadolibre.com.ar/MLA-123456789-camara-_JM';
const catalogUrl = 'https://www.mercadolibre.com.ar/p/MLA24681012';

function fixture(name: string): Document {
  return new DOMParser().parseFromString(readFileSync(`tests/fixtures/${name}.html`, 'utf8'), 'text/html');
}

function html(content: string): Document {
  return new DOMParser().parseFromString(content, 'text/html');
}

function structured(product: Record<string, unknown>): Document {
  return html(`<script type="application/ld+json">${JSON.stringify(product)}</script>`);
}

function supportedPage(document: Document, url: string) {
  const result = extractPublicPage(document, url);
  if (result.status === 'unsupported') throw new Error(`Expected a supported page: ${result.reason}`);
  return result;
}

describe('public marketplace extraction', () => {
  it('extracts a listing using structured public data and field provenance', () => {
    const result = supportedPage(fixture('listing'), `${listingUrl}?csrf=discard-me#tracking`);
    expect(result.status).toBe('complete');
    expect(result.snapshot).toMatchObject({
      siteId: 'MLA', kind: 'listing', canonicalUrl: listingUrl,
      listingId: 'MLA123456789', productId: null, title: 'Camara de prueba',
      price: { amountMinor: 123456, currency: 'ARS', exponent: 2 },
      seller: { id: '98765', name: 'TIENDA_PRUEBA', url: 'https://www.mercadolibre.com.ar/perfil/TIENDA_PRUEBA' },
      extractorRevision: 'public-v1',
      observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      provenance: { title: { source: 'json-ld', url: listingUrl }, price: { source: 'json-ld', url: listingUrl } },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-|discard-me|csrf|buyerId|root_user_id/);
  });

  it('handles arrays, @graph and references without selecting a recommendation', () => {
    const result = supportedPage(fixture('catalog'), catalogUrl);
    expect(result.status).toBe('complete');
    expect(result.snapshot).toMatchObject({
      kind: 'catalog', productId: 'MLA24681012', listingId: null,
      title: 'Auriculares de prueba', price: { amountMinor: 249990, currency: 'ARS' },
      seller: { name: 'VENDEDOR_CATALOGO', id: null, url: null },
    });
  });

  it('prefers an explicitly identified catalog over an unidentified product', () => {
    const document = html('<script type="application/ld+json">[{"@type":"Product","name":"Sin identidad"},{"@type":"Product","url":"/p/MLA24681012","name":"Actual"}]</script>');
    expect(supportedPage(document, catalogUrl).snapshot).toMatchObject({ title: 'Actual' });
  });

  it('keeps public title and seller when price is absent', () => {
    const result = supportedPage(fixture('incomplete'), listingUrl);
    expect(result.status).toBe('partial');
    expect(result.snapshot).toMatchObject({
      title: 'Publicacion sin precio', price: null,
      seller: { name: 'VENDEDOR_PARCIAL', id: null },
      provenance: { title: { source: 'meta' }, 'seller.name': { source: 'dom' } },
    });
  });

  it.each([
    'https://attacker.test/p/MLA24681012',
    'https://mercadolibre.com.ar.attacker.test/p/MLA24681012',
    'https://evilmercadolibre.com.ar/p/MLA24681012',
    'http://www.mercadolibre.com.ar/p/MLA24681012',
    'https://user@www.mercadolibre.com.ar/p/MLA24681012',
    'https://www.mercadolibre.com.ar:8443/p/MLA24681012',
    'https://www.mercadolibre.com.ar/my-account?item_id=MLA123456789',
    'https://www.mercadolibre.com.ar/my-account/orders/p/MLA24681012',
    'https://www.mercadolibre.com.ar/p/MLA24681012-attacker',
    'https://www.mercadolibre.com.ar/p/MLA00000000',
    'https://www.mercadolivre.com.br/p/MLB24681012',
  ])('does not read a document on an unauthorized origin, market or route: %s', (url) => {
    const document = fixture('unsupported');
    const read = vi.spyOn(document, 'querySelectorAll');
    expect(extractPublicPage(document, url).status).toBe('unsupported');
    expect(read).not.toHaveBeenCalled();
  });

  it('does not follow a canonical link pointing to another product or another origin', () => {
    for (const href of ['https://attacker.test/p/MLA24681012', '/p/MLA99999999']) {
      const result = supportedPage(html(`<link rel="canonical" href="${href}"><h1 class="ui-pdp-title">Actual</h1>`), catalogUrl);
      expect(result.snapshot).toMatchObject({ canonicalUrl: catalogUrl, productId: 'MLA24681012', title: 'Actual' });
    }
  });

  it('distinguishes a selected listing from its catalog product ID', () => {
    const result = supportedPage(fixture('catalog'), `${catalogUrl}?pdp_filters=item_id:MLA123456789&csrf=discard-me`);
    expect(result.snapshot).toMatchObject({ productId: 'MLA24681012', listingId: 'MLA123456789', canonicalUrl: catalogUrl });
    expect(JSON.stringify(result)).not.toContain('discard-me');
  });

  it('falls back from malformed JSON-LD to public DOM and metadata', () => {
    const result = supportedPage(html('<script type="application/ld+json">{broken</script><h1 class="ui-pdp-title">Respaldo</h1><meta property="product:price:amount" content="12.34"><meta property="product:price:currency" content="USD">'), listingUrl);
    expect(result.snapshot).toMatchObject({ title: 'Respaldo', price: { amountMinor: 1234, currency: 'USD' } });
  });

  it('normalizes a visible split price without treating adjacent text as an amount', () => {
    const result = supportedPage(html('<h1 class="ui-pdp-title">Producto</h1><div class="ui-pdp-price__second-line"><span class="andes-money-amount"><span class="andes-money-amount__currency-symbol">$</span><span class="andes-money-amount__fraction">1.234</span><span class="andes-money-amount__cents">56</span></span><span>12 cuotas</span></div>'), listingUrl);
    expect(result.snapshot).toMatchObject({ price: { amountMinor: 123456, currency: 'ARS' }, provenance: { price: { source: 'dom' } } });
  });

  it('retains USD instead of silently converting a visible price to the site currency', () => {
    const result = supportedPage(html('<div class="ui-pdp-price__second-line"><span class="andes-money-amount"><span class="andes-money-amount__currency-symbol">US$</span><span class="andes-money-amount__fraction">10</span></span></div>'), listingUrl);
    expect(result.snapshot).toMatchObject({ price: { amountMinor: 1000, currency: 'USD' } });
  });

  it('does not use an AggregateOffer lowPrice or an arbitrary offer as the current price', () => {
    for (const offers of [
      { '@type': 'AggregateOffer', lowPrice: '1', highPrice: '2', priceCurrency: 'ARS' },
      [{ '@type': 'Offer', price: '1', priceCurrency: 'ARS' }, { '@type': 'Offer', price: '2', priceCurrency: 'ARS' }],
    ]) {
      const result = supportedPage(structured({ '@type': 'Product', name: 'Catalogo', offers }), catalogUrl);
      expect(result.snapshot).toMatchObject({ title: 'Catalogo', price: null });
    }
  });

  it('accepts a public catalog slug while rejecting nested private routes', () => {
    const result = supportedPage(fixture('catalog'), 'https://www.mercadolibre.com.ar/auriculares/p/MLA24681012');
    expect(result.snapshot).toMatchObject({ productId: 'MLA24681012' });
  });

  it('does not accept a lone offer belonging to a different listing', () => {
    const result = supportedPage(structured({
      '@type': 'Product', name: 'Producto actual',
      offers: { '@type': 'Offer', url: '/MLA-99999999-otro', price: '1', priceCurrency: 'ARS', seller: { name: 'OTRO' } },
    }), listingUrl);
    expect(result.snapshot).toMatchObject({ title: 'Producto actual', price: null, seller: null });
  });

  it('selects a catalog offer only when it matches the explicitly selected listing', () => {
    const document = structured({
      '@type': 'Product', name: 'Catalogo',
      offers: [
        { '@type': 'Offer', url: '/MLA-99999999-otro', price: '1', priceCurrency: 'ARS' },
        { '@type': 'Offer', url: '/MLA-123456789-actual', price: '2', priceCurrency: 'ARS', seller: { name: 'ACTUAL' } },
      ],
    });
    const result = supportedPage(document, `${catalogUrl}?pdp_filters=item_id:MLA123456789`);
    expect(result.snapshot).toMatchObject({ listingId: 'MLA123456789', price: { amountMinor: 200 }, seller: { name: 'ACTUAL' } });
  });

  it('does not resolve conflicting structured identifiers by picking one', () => {
    const result = supportedPage(structured({
      '@type': 'Product', sku: 'MLA99999999', url: listingUrl, name: 'Identidad ambigua',
      offers: { '@type': 'Offer', price: '1', priceCurrency: 'ARS' },
    }), listingUrl);
    expect(result.snapshot).toMatchObject({ title: null, price: null });
  });

  it('handles ambiguous or cyclic @id references without leaking partial state', () => {
    const document = html(`<script type="application/ld+json">${JSON.stringify({ '@graph': [
      { '@type': 'Product', name: 'Actual', offers: { '@id': '#oferta' } },
      { '@type': 'Offer', '@id': '#oferta', price: '1', priceCurrency: 'ARS' },
      { '@type': 'Offer', '@id': '#oferta', price: '2', priceCurrency: 'ARS' },
    ] })}</script>`);
    expect(supportedPage(document, listingUrl).snapshot).toMatchObject({ title: 'Actual', price: null });
    const cyclic = html('<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Actual","offers":{"@id":"#cycle"}},{"@id":"#cycle"}]}</script>');
    expect(supportedPage(cyclic, listingUrl).snapshot).toMatchObject({ title: 'Actual', price: null });
  });

  it('does not mix data from a structured product with a mismatched listing ID', () => {
    const result = supportedPage(structured({ '@type': 'Product', sku: 'MLA99999999', name: 'Recomendado', offers: { '@type': 'Offer', price: '1', priceCurrency: 'ARS' } }), listingUrl);
    expect(result.snapshot).toMatchObject({ title: null, price: null, seller: null });
  });

  it('rejects an unsafe seller URL without discarding its public name', () => {
    const result = supportedPage(structured({ '@type': 'Product', name: 'Producto', offers: { '@type': 'Offer', price: '1', priceCurrency: 'ARS', seller: { '@type': 'Organization', name: 'PUBLICO', url: 'javascript:alert(1)', csrfToken: 'private-value' } } }), listingUrl);
    expect(result.snapshot).toMatchObject({ seller: { name: 'PUBLICO', url: null, id: null } });
    expect(JSON.stringify(result)).not.toMatch(/private-value|javascript:/);
  });

  it.each(['-1', '1e3', '1234.567', '900719925474099999'])('keeps valid public fields when a structured price is invalid: %s', (price) => {
    const result = supportedPage(structured({ '@type': 'Product', name: 'Producto valido', offers: { '@type': 'Offer', price, priceCurrency: 'ARS' } }), listingUrl);
    expect(result.snapshot).toMatchObject({ title: 'Producto valido', price: null });
  });

  it('does not infer missing or unsupported structured currency', () => {
    for (const priceCurrency of [undefined, 'UNKNOWN']) {
      const result = supportedPage(structured({ '@type': 'Product', name: 'Producto', offers: { '@type': 'Offer', price: '12.34', priceCurrency } }), listingUrl);
      expect(result.snapshot).toMatchObject({ title: 'Producto', price: null });
    }
  });

  it('does not evaluate scripts, traverse cookie/session globals or modify the host DOM', () => {
    const document = fixture('listing');
    const before = document.documentElement.outerHTML;
    const cookie = vi.spyOn(Document.prototype, 'cookie', 'get').mockImplementation(() => { throw new Error('Cookie access forbidden'); });
    expect(extractPublicPage(document, listingUrl).status).toBe('complete');
    expect(cookie).not.toHaveBeenCalled();
    expect(document.documentElement.outerHTML).toBe(before);
  });
});