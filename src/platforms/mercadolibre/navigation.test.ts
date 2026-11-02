import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionResult } from '../../shared/contracts';
import { extractPublicPage } from './extract';
import { createNavigationController, observePublicPage } from './navigation';

const firstUrl = 'https://articulo.mercadolibre.com.ar/MLA-123456789-primero';
const secondUrl = 'https://articulo.mercadolibre.com.ar/MLA-987654321-segundo';

function result(title: string, url: string): ExtractionResult {
  const document = new DOMParser().parseFromString(`<h1 class="ui-pdp-title">${title}</h1>`, 'text/html');
  return extractPublicPage(document, url);
}

afterEach(() => vi.useRealTimers());

describe('navigation lifecycle', () => {
  it('reconnects when an SPA replaces the public container or its parent', async () => {
    const document = new DOMParser().parseFromString('<div id="host"><main><h1 class="ui-pdp-title">Primero</h1></main></div>', 'text/html');
    const changed = vi.fn();
    const stop = observePublicPage(document, changed);
    const replacement = document.createElement('main');
    replacement.innerHTML = '<h1 class="ui-pdp-title">Segundo</h1>';
    document.querySelector('main')?.replaceWith(replacement);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    replacement.querySelector('h1')!.textContent = 'Segundo actualizado';
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    const parent = document.createElement('div');
    parent.innerHTML = '<main><h1 class="ui-pdp-title">Tercero</h1></main>';
    document.querySelector('#host')?.replaceWith(parent);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
    parent.querySelector('h1')!.textContent = 'Tercero actualizado';
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(4));
    stop();
    parent.querySelector('h1')!.textContent = 'No observado';
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('observes public data changes but ignores extension UI changes and disconnects on close', async () => {
    const document = new DOMParser().parseFromString('<main><h1 class="ui-pdp-title">Primero</h1><meli-extension-panel></meli-extension-panel></main>', 'text/html');
    const changed = vi.fn();
    const stop = observePublicPage(document, changed);
    const title = document.querySelector('h1');
    if (!title) throw new Error('Missing fixture title');
    title.textContent = 'Segundo';
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    document.querySelector('meli-extension-panel')?.append(document.createElement('button'));
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    stop();
    title.textContent = 'Tercero';
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
  });

  it('debounces changes for 200 ms and extracts only the most recent URL', async () => {
    vi.useFakeTimers();
    const extract = vi.fn((url: string) => result('Actual', url));
    const publish = vi.fn();
    const controller = createNavigationController({ extract, publish });
    controller.navigate(firstUrl);
    controller.navigate(secondUrl);
    await vi.advanceTimersByTimeAsync(199);
    expect(extract).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(extract).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledWith(secondUrl, expect.any(AbortSignal));
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { title: 'Actual' }, stale: false });
  });

  it('aborts A immediately and never replaces B with a late response from A', async () => {
    vi.useFakeTimers();
    let finishFirst!: (value: ExtractionResult) => void;
    let firstSignal!: AbortSignal;
    const extract = vi.fn((url: string, signal: AbortSignal) => {
      if (url === firstUrl) {
        firstSignal = signal;
        return new Promise<ExtractionResult>((resolve) => { finishFirst = resolve; });
      }
      return Promise.resolve(result('Segundo', url));
    });
    const controller = createNavigationController({ extract, publish: vi.fn() });
    controller.navigate(firstUrl);
    await vi.advanceTimersByTimeAsync(200);
    controller.navigate(secondUrl);
    expect(firstSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    finishFirst(result('Primero', firstUrl));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState()).toMatchObject({ status: 'ready', snapshot: { title: 'Segundo' } });
  });

  it('marks the previous snapshot stale while loading the next page', async () => {
    vi.useFakeTimers();
    const controller = createNavigationController({ extract: (url) => result('Primero', url), publish: vi.fn() });
    controller.navigate(firstUrl);
    await vi.advanceTimersByTimeAsync(200);
    controller.navigate(secondUrl);
    expect(controller.getState()).toMatchObject({ status: 'loading', stale: true, snapshot: { title: 'Primero' } });
  });

  it('returns a safe recoverable error instead of exposing exception details', async () => {
    vi.useFakeTimers();
    const controller = createNavigationController({ extract: () => { throw new Error('private-html-body'); }, publish: vi.fn() });
    controller.navigate(firstUrl);
    await vi.advanceTimersByTimeAsync(200);
    expect(controller.getState().status).toBe('error');
    expect(JSON.stringify(controller.getState())).not.toContain('private-html-body');
  });

  it('cancels timers and requests and stops publishing after close', async () => {
    vi.useFakeTimers();
    const extract = vi.fn((url: string) => result('Actual', url));
    const publish = vi.fn();
    const controller = createNavigationController({ extract, publish });
    controller.navigate(firstUrl);
    controller.stop();
    const publications = publish.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    controller.navigate(secondUrl);
    await vi.advanceTimersByTimeAsync(1000);
    expect(extract).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(publications);
  });
});