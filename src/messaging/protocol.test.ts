import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import { createHistoryMessageHandler, createMessageHandler, createMarketplaceMessageHandler } from './protocol';
import { createHistoryStore } from '../background/store';
import type { PublicPageSnapshot } from '../shared/contracts';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const requestId = 'ce155c60-0e5a-4d7f-8295-f9ac878ecb3c';
const preferences = { schemaVersion: 1 as const, panelEnabled: true };
const request = {
  version: 1,
  requestId,
  operation: 'status.get',
  payload: {},
};
const extensionSender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/popup.html`,
};
const marketplaceSender = {
  id: extensionId,
  url: 'https://www.mercadolibre.com.ar/p/MLA12345',
  origin: 'https://www.mercadolibre.com.ar',
  tab: { id: 7 },
  frameId: 0,
};

function setup() {
  const initialize = vi.fn(async () => preferences);
  return {
    initialize,
    handle: createMessageHandler({ extensionId, initialize }),
  };
}

describe('message protocol', () => {
  it('binds public seller operations to the sender publication and refuses cross-seller deletion', async () => {
    const name = `protocol-sellers-${crypto.randomUUID()}`; const history = createHistoryStore(name);
    const handle = createMarketplaceMessageHandler({ extensionId, history });
    const snapshot: PublicPageSnapshot = { siteId: 'MLA', locale: 'es-AR', kind: 'catalog', listingId: null, productId: 'MLA12345', canonicalUrl: marketplaceSender.url,
      title: 'Fixture', price: null, imageUrl: null, seller: { id: '98765', name: 'Fixture', url: 'https://www.mercadolibre.com.ar/perfil/FIXTURE_A' }, observedAt: new Date().toISOString(), extractorRevision: 'public-v1', provenance: {} };
    const message = (operation: string, payload: unknown) => ({ ...request, operation, payload });
    try {
      expect(await handle(message('sellers.save', { snapshot }), marketplaceSender)).toMatchObject({ ok: true });
      expect(await handle(message('sellers.read', { snapshot }), marketplaceSender)).toMatchObject({ ok: true, data: { contacts: [{ sellerId: '98765' }] } });
      expect(await handle(message('sellers.read', { snapshot: { ...snapshot, productId: 'MLA99999', canonicalUrl: 'https://www.mercadolibre.com.ar/p/MLA99999' } }), marketplaceSender)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      const key = JSON.stringify(['MLA', '12345', 'profile', snapshot.seller!.url]);
      expect(await handle(message('sellers.remove', { snapshot, key, confirmed: true }), marketplaceSender)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(await handle(message('catalog.read', { productId: 'MLA12345' }), marketplaceSender)).toMatchObject({ ok: true, data: { result: { status: 'unavailable', reason: 'no-authorized-source' } } });
      expect(await handle(message('catalog.read', { productId: 'MLA99999' }), marketplaceSender)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(await handle(message('sellers.save', { snapshot }), { ...marketplaceSender, id: 'foreign' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(await handle(message('sellers.remove', { snapshot, key, confirmed: false }), extensionSender)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    } finally { await history.close(); await deleteDB(name); }
  });

  it('commits explicit public captures while reserving imports and destructive operations to own pages', async () => {
    const name = `protocol-history-${crypto.randomUUID()}`;
    const history = createHistoryStore(name);
    const open = vi.fn(async () => {});
    const handle = createHistoryMessageHandler({ extensionId, history, open });
    const snapshot: PublicPageSnapshot = { siteId: 'MLA', locale: 'es-AR', kind: 'catalog', listingId: null, productId: 'MLA12345',
      canonicalUrl: marketplaceSender.url, title: 'Fixture', price: null, imageUrl: null, seller: null,
      observedAt: new Date().toISOString(), extractorRevision: 'public-v1', provenance: {} };
    const message = (operation: string, payload: unknown) => ({ ...request, operation, payload });
    try {
      expect(await handle(message('history.manage', { key: 'MLA:catalog:MLA12345' }), marketplaceSender)).toMatchObject({ ok: true });
      expect(open).toHaveBeenCalledExactlyOnceWith('MLA:catalog:MLA12345');
      expect(await handle(message('history.follow', { snapshot }), marketplaceSender)).toMatchObject({ ok: true });
      expect(await handle(message('history.capture', { snapshot }), marketplaceSender)).toMatchObject({ ok: true, data: { kind: 'capture', status: 'recorded' } });
      expect(await handle(message('history.read', { key: 'MLA:catalog:MLA12345' }), marketplaceSender)).toMatchObject({ ok: true, data: { observations: [ { snapshot } ] } });
      expect(await handle(message('history.list', {}), extensionSender)).toMatchObject({ ok: true, data: { publications: [ { following: true } ] } });
      for (const [operation, payload] of [ ['history.list', {}], ['history.export', {}], ['history.clear', { confirmed: true }],
        ['history.remove', { key: 'MLA:catalog:MLA12345', confirmed: true }], ['history.prune', { days: 90, confirmed: true }],
        ['history.import', { archive: await history.archive() }], ['history.read', { key: 'MLA:catalog:MLA99999' }] ] as const) {
        expect(await handle(message(operation, payload), marketplaceSender)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      }
      expect(await history.list()).toHaveLength(1);
      expect(await handle(message('history.clear', { confirmed: false }), extensionSender)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
      expect(await handle(message('history.capture', { snapshot, token: 'private-fixture' }), marketplaceSender)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
      expect(await handle(message('history.follow', { snapshot }), { ...marketplaceSender, id: 'foreign' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      const record = vi.spyOn(history, 'record').mockRejectedValueOnce(Object.assign(new Error('private-quota-details'), { code: 'storage-full' }));
      const failure = await handle(message('history.capture', { snapshot }), marketplaceSender);
      expect(failure).toMatchObject({ ok: false, error: { code: 'storage-full' } });
      expect(JSON.stringify(failure)).not.toContain('private-quota-details'); record.mockRestore();
    } finally { await history.close(); await deleteDB(name); }
  });

  it('saves panel preferences only from a trusted extension page', async () => {
    const save = vi.fn(async () => {});
    const handle = createMessageHandler({ extensionId, initialize: async () => preferences, save });
    const response = await handle({ ...request, operation: 'preferences.set', payload: { panelEnabled: false } }, extensionSender);
    expect(response).toMatchObject({ ok: true, data: { schemaVersion: 1, panelEnabled: false } });
    expect(save).toHaveBeenCalledWith({ schemaVersion: 1, panelEnabled: false });
    expect(await handle({ ...request, operation: 'preferences.get' }, extensionSender))
      .toMatchObject({ ok: true, data: { panelEnabled: false } });
  });

  it('forbids preference writes from a content script even on an allowed domain', async () => {
    const save = vi.fn(async () => {});
    const handle = createMessageHandler({ extensionId, initialize: async () => preferences, save });
    expect(await handle({ ...request, operation: 'preferences.set', payload: { panelEnabled: false } }, marketplaceSender))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('preserves cached preferences if saving fails', async () => {
    const handle = createMessageHandler({ extensionId, initialize: async () => preferences,
      save: async () => { throw new Error('private-write-error'); } });
    const response = await handle({ ...request, operation: 'preferences.set', payload: { panelEnabled: false } }, extensionSender);
    expect(response).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(response)).not.toContain('private-write-error');
    expect(await handle({ ...request, operation: 'preferences.get' }, extensionSender))
      .toMatchObject({ ok: true, data: { panelEnabled: true } });
  });

  it('reports the implemented milestone without claiming unavailable features', async () => {
    const { handle } = setup();
    await expect(handle(request, extensionSender)).resolves.toEqual({
      version: 1,
      requestId,
      ok: true,
      data: {
        completedMilestone: 7,
        mode: 'local',
        networkEnabled: false,
        capabilities: {
          analysis: 'available',
          profitability: 'available',
          history: 'available',
          catalogComparison: 'available',
          catalog: 'unavailable',
          buybox: 'unavailable',
          contacts: 'available',
          assistant: 'disabled',
        },
      },
    });
  });

  it('accepts a same-extension content script on the authorized marketplace', async () => {
    const { handle } = setup();
    expect(await handle(request, marketplaceSender)).toMatchObject({ ok: true, requestId });
  });

  it('accepts the marketplace root and valid subdomains', async () => {
    const { handle } = setup();
    for (const url of [
      'https://mercadolibre.com.ar/',
      'https://articulo.mercadolibre.com.ar/MLA-12345',
    ]) {
      expect(await handle(request, { ...marketplaceSender, url, origin: new URL(url).origin }))
        .toMatchObject({ ok: true });
    }
  });

  it.each([
    { ...extensionSender, id: 'another-extension' },
    { url: extensionSender.url },
    { id: extensionId },
    { ...marketplaceSender, url: 'https://mercadolibre.com.ar.attacker.test/' },
    { ...marketplaceSender, url: 'https://evilmercadolibre.com.ar/' },
    { ...marketplaceSender, url: 'http://www.mercadolibre.com.ar/' },
    { ...marketplaceSender, url: 'https://www.mercadolibre.com.ar:8443/' },
    { ...marketplaceSender, url: 'https://username@www.mercadolibre.com.ar/' },
    { ...marketplaceSender, origin: 'https://attacker.test' },
    { ...marketplaceSender, origin: 'null' },
    { ...marketplaceSender, frameId: 2 },
    { ...marketplaceSender, documentLifecycle: 'prerender' },
    { ...marketplaceSender, tab: { id: -1 } },
    { ...marketplaceSender, tab: undefined },
  ])('rejects an untrusted sender without accessing storage: %j', async (sender) => {
    const { handle, initialize } = setup();
    expect(await handle(request, sender)).toMatchObject({
      version: 1,
      requestId: null,
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(initialize).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { ...request, version: 2 },
    { ...request, requestId: 'invalid' },
    { ...request, operation: 'fetch' },
    { ...request, url: 'https://attacker.test/' },
    { ...request, payload: { csrfToken: 'must-not-be-reflected' } },
    { ...request, payload: { userId: 123 } },
    { ...request, payload: { headers: { Authorization: 'must-not-be-reflected' } } },
  ])('rejects unknown operations and fields without echoing input: %j', async (message) => {
    const { handle, initialize } = setup();
    const response = await handle(message, extensionSender);
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(JSON.stringify(response)).not.toContain('must-not-be-reflected');
    expect(initialize).not.toHaveBeenCalled();
  });

  it('waits for initialization and loads state only once for concurrent requests', async () => {
    let finishInitialization!: (value: typeof preferences) => void;
    const initialize = vi.fn(() => new Promise<typeof preferences>((resolve) => {
      finishInitialization = resolve;
    }));
    const handle = createMessageHandler({ extensionId, initialize });
    const first = handle(request, extensionSender);
    const second = handle({ ...request, operation: 'preferences.get' }, extensionSender);
    await vi.waitFor(() => expect(initialize).toHaveBeenCalledOnce());
    finishInitialization(preferences);
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toEqual({ version: 1, requestId, ok: true, data: preferences });
    expect(initialize).toHaveBeenCalledOnce();
  });

  it('does not leak storage errors and permits recovery after a failed initialization', async () => {
    const initialize = vi.fn()
      .mockRejectedValueOnce(new Error('private-storage-value'))
      .mockResolvedValueOnce(preferences);
    const handle = createMessageHandler({ extensionId, initialize });
    const failed = await handle(request, extensionSender);
    expect(failed).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(failed)).not.toContain('private-storage-value');
    expect(await handle(request, extensionSender)).toMatchObject({ ok: true });
  });
});