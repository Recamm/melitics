import { describe, expect, it, vi } from 'vitest';
import type { PublicPageSnapshot } from '../../shared/contracts';
import { buildAssistantRequest, createAssistantClient, validateAssistantProposal, validateAssistantRequest } from './client';

const snapshot: PublicPageSnapshot = {
  siteId: 'MLA', locale: 'es-AR', kind: 'listing', listingId: 'MLA123456789', productId: null,
  canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-123456789-prueba', title: 'Camara de prueba',
  price: { amountMinor: 10000, currency: 'ARS', exponent: 2 }, imageUrl: null,
  seller: { id: '98765', name: 'Fixture privado del vendedor', url: 'https://www.mercadolibre.com.ar/perfil/FIXTURE' },
  observedAt: '2026-11-01T12:00:00.000Z', extractorRevision: 'public-v1', provenance: {},
};
function request() {
  return { schemaVersion: 1, requestId: 'ce155c60-0e5a-4d7f-8295-f9ac878ecb3c', task: 'title',
    product: { siteId: 'MLA', listingId: snapshot.listingId, productId: null, title: snapshot.title, canonicalUrl: snapshot.canonicalUrl, observedAt: snapshot.observedAt },
    preferences: { locale: 'es-AR', tone: 'neutral' } };
}
function proposal() {
  return { schemaVersion: 1, requestId: request().requestId, task: 'title', title: { text: 'Camara de prueba revisada', sources: [] }, description: null, attributes: [] };
}

describe('assistant privacy boundary with no provider enabled', () => {
  it('bounds descriptions and attributes, refuses duplicate names and never treats a citation as verification', () => {
    const descriptionRequest = { ...request(), task: 'description' };
    const description = { ...proposal(), task: 'description', title: null, description: { text: 'Descripcion fixture', sources: [snapshot.canonicalUrl] } };
    expect(validateAssistantProposal(description, descriptionRequest)).toMatchObject({ description: { verified: false } });
    expect(() => validateAssistantProposal({ ...description, description: { text: 'x'.repeat(5001), sources: [] } }, descriptionRequest)).toThrow();
    const attributesRequest = { ...request(), task: 'attributes' };
    const attribute = { name: 'Modelo', value: { text: 'Fixture', sources: [] } };
    const attributes = { ...proposal(), task: 'attributes', title: null, attributes: [attribute] };
    expect(() => validateAssistantProposal({ ...attributes, attributes: [attribute, { ...attribute, name: 'modelo' }] }, attributesRequest)).toThrow();
    expect(() => validateAssistantProposal({ ...attributes, attributes: Array.from({ length: 41 }, (_, index) => ({ ...attribute, name: `Atributo ${index}` })) }, attributesRequest)).toThrow();
    expect(() => validateAssistantProposal({ ...attributes, attributes: [{ ...attribute, value: { ...attribute.value, apiKey: 'private-fixture' } }] }, attributesRequest)).toThrow();
  });

  it('projects only the explicit public product allowlist and never includes seller, images, price or provenance', () => {
    const built = buildAssistantRequest(snapshot, 'title', { locale: 'es-AR', tone: 'neutral' });
    expect(built).toMatchObject({ schemaVersion: 1, task: 'title', product: request().product, preferences: request().preferences });
    expect(JSON.stringify(built)).not.toMatch(/seller|98765|imageUrl|amountMinor|provenance|Fixture privado/);
  });
  it.each(['html', 'cookies', 'csrfToken', 'buyerId', 'apiKey', 'accessToken'])('rejects extra private field %s at every request level', field => {
    for (const value of [{ ...request(), [field]: 'private-fixture' }, { ...request(), product: { ...request().product, [field]: 'private-fixture' } }, { ...request(), preferences: { ...request().preferences, [field]: 'private-fixture' } }]) {
      expect(() => validateAssistantRequest(value)).toThrow();
    }
  });
  it('rejects a whole HTML document, URL session parameters, unsupported tasks and oversized input', () => {
    for (const value of [ '<html><body>private-fixture</body></html>',
      { ...request(), product: { ...request().product, title: '<html><body>private-fixture</body></html>' } },
      { ...request(), product: { ...request().product, canonicalUrl: `${snapshot.canonicalUrl}?token=private-fixture` } },
      { ...request(), task: 'publish' }, { ...request(), product: { ...request().product, title: 'x'.repeat(501) } },
    ]) expect(() => validateAssistantRequest(value)).toThrow();
  });
  it('returns disabled for both consent values, with no network request or generated proposal', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const consent of [false, true]) expect(await createAssistantClient().generate(request(), { consent, signal: new AbortController().signal })).toEqual({ status: 'disabled', reason: 'no-provider', proposal: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels an already aborted request and validates input even while disabled', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(createAssistantClient().generate(request(), { consent: true, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(createAssistantClient().generate({ ...request(), cookies: 'private-fixture' }, { consent: true, signal: new AbortController().signal })).rejects.toBeTruthy();
  });
  it('validates proposed text as data, binds it to a request and marks uncited claims', () => {
    expect(validateAssistantProposal(proposal(), request())).toMatchObject({ title: { verified: false } });
    expect(() => validateAssistantProposal({ ...proposal(), requestId: '1e155c60-0e5a-4d7f-8295-f9ac878ecb3c' }, request())).toThrow();
    expect(() => validateAssistantProposal({ ...proposal(), tools: [{ name: 'publish' }] }, request())).toThrow();
    expect(() => validateAssistantProposal({ ...proposal(), title: { text: 'Fixture', sources: ['javascript:alert(1)'] } }, request())).toThrow();
    expect(() => validateAssistantProposal({ ...proposal(), title: { text: 'Fixture', sources: ['https://www.mercadolibre.com.ar/p/MLA99999'] } }, request())).toThrow();
  });
});