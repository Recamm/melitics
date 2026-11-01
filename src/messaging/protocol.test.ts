import { describe, expect, it, vi } from 'vitest';
import { createMessageHandler } from './protocol';

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
  it('reports the implemented milestone without claiming unavailable features', async () => {
    const { handle } = setup();
    await expect(handle(request, extensionSender)).resolves.toEqual({
      version: 1,
      requestId,
      ok: true,
      data: {
        completedMilestone: 1,
        mode: 'local',
        networkEnabled: false,
        capabilities: {
          analysis: 'unavailable',
          history: 'unavailable',
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