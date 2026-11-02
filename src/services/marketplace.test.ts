import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarketplaceService } from './marketplace';

afterEach(() => vi.useRealTimers());
const source = (loadPage: () => Promise<Response>) => ({ authorization: 'approved' as const, id: 'fixture-only', documentationUrl: 'https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion', loadPage });
const page = (nextCursor: string | null = null) => new Response(JSON.stringify({ offers: [], buybox: [], nextCursor }), { headers: { 'Content-Type': 'application/json' } });

describe('authorized marketplace sources only', () => {
  it('consumes every cursor page only through an explicitly approved adapter', async () => {
    const loadPage = vi.fn().mockResolvedValueOnce(page('next')).mockResolvedValueOnce(page());
    expect(await createMarketplaceService(source(loadPage)).offers('MLA111111111', new AbortController().signal)).toMatchObject({ status: 'ready', sourceId: 'fixture-only' });
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(loadPage.mock.calls[1]?.[0]).toMatchObject({ cursor: 'next' });
  });
  it.each([401, 403])('never retries authorization denial %i', async status => {
    const loadPage = vi.fn(async () => new Response('private-error-fixture', { status }));
    await expect(createMarketplaceService(source(loadPage)).offers('MLA111111111', new AbortController().signal)).rejects.toMatchObject({ code: 'forbidden' });
    expect(loadPage).toHaveBeenCalledOnce();
  });
  it('respects Retry-After for 429 instead of immediate polling', async () => {
    vi.useFakeTimers();
    const loadPage = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } })).mockResolvedValueOnce(page());
    const result = createMarketplaceService(source(loadPage)).offers('MLA111111111', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(999); expect(loadPage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toMatchObject({ status: 'ready' });
  });
  it('performs at most two transient retries and never returns a partially completed catalog', async () => {
    vi.useFakeTimers(); const loadPage = vi.fn(async () => new Response('', { status: 503 }));
    const check = expect(createMarketplaceService(source(loadPage)).offers('MLA111111111', new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(1000); await check; expect(loadPage).toHaveBeenCalledTimes(3);
  });
  it('times out the entire operation at 10 seconds even when an adapter ignores cancellation', async () => {
    vi.useFakeTimers(); const loadPage = vi.fn(() => new Promise<Response>(() => {}));
    const check = expect(createMarketplaceService(source(loadPage)).offers('MLA111111111', new AbortController().signal)).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10000); await check; expect(loadPage).toHaveBeenCalledOnce();
  });
  it('cancels navigation requests and refuses repeated cursors', async () => {
    const controller = new AbortController(); const loadPage = vi.fn(() => new Promise<Response>(() => {}));
    const result = createMarketplaceService(source(loadPage)).offers('MLA111111111', controller.signal); controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const repeated = vi.fn(async () => page('same'));
    await expect(createMarketplaceService(source(repeated)).offers('MLA111111111', new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-input' });
    expect(repeated).toHaveBeenCalledTimes(2);
  });

  it('remains unavailable without an authorized source instead of returning demonstration data', async () => {
    expect(await createMarketplaceService().offers('MLA111111111', new AbortController().signal))
      .toMatchObject({ status: 'unavailable', reason: 'no-authorized-source', offers: [] });
  });
});