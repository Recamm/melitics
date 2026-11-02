import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { App } from '../src/ui/App';
import '../src/ui/styles.css';
import { historyRequest, workerRequest } from '../src/messaging/client';
import { errorResponse, panelRequestSchema, preferencesChangedSchema } from '../src/messaging/protocol';
import { preferencesSchema, PROTOCOL_VERSION, type PanelState } from '../src/shared/contracts';
import { extractPublicPage } from '../src/platforms/mercadolibre/extract';
import { marketplaceUrl, pageIdentity } from '../src/platforms/mercadolibre/markets';
import { createNavigationController, observePublicPage } from '../src/platforms/mercadolibre/navigation';

type Mounted = { root: Root; controller: ReturnType<typeof createNavigationController>; disconnect: () => void; focus: () => void };

export default defineContentScript({
  matches: ['https://*.mercadolibre.com.ar/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  main(ctx) {
    let ui: { remove: () => void; mounted: Mounted | undefined } | undefined;
    let opening: Promise<void> | null = null;
    let generation = 0;
    let enabled = true;
    let manuallyClosed = false;
    let previousFocus: HTMLElement | null = null;
    let state: PanelState = { status: 'loading', snapshot: null, stale: false, message: null };

    function close(returnFocus = true): void {
      generation += 1;
      opening = null;
      ui?.remove();
      ui = undefined;
      if (returnFocus && previousFocus?.isConnected) previousFocus.focus();
    }

    function snapshotState(): PanelState {
      const result = extractPublicPage(document, location.href);
      return result.status === 'unsupported'
        ? { status: 'unsupported', snapshot: null, stale: false, message: 'Publicacion no compatible.' }
        : { status: 'ready', snapshot: result.snapshot, stale: false, message: null };
    }

    function open(focus: boolean): Promise<void> {
      if (ui?.mounted) {
        if (focus) { previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; ui.mounted.focus(); }
        return Promise.resolve();
      }
      if (opening) return opening;
      const current = ++generation;
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const promise = (async () => {
        const created = await createShadowRootUi(ctx, {
          name: 'meli-extension-panel', position: 'overlay', alignment: 'top-right', zIndex: 2147483646,
          anchor: 'body', append: 'last', isolateEvents: true,
          onMount(container): Mounted {
            const root = createRoot(container);
            const controller = createNavigationController({
              extract: (url, signal) => {
                if (signal.aborted || !ctx.isValid) throw new Error('Invalid context');
                return extractPublicPage(document, url);
              },
              publish: (next) => {
                state = next;
                root.render(<App state={next} mode="panel" autoFocus={focus} onManage={async key => { await historyRequest('history.manage', { key }, 'done'); }} onRefresh={() => controller.navigate(location.href)} onClose={() => { manuallyClosed = true; close(); }} />);
                if (ctx.isValid) void browser.runtime.sendMessage({ type: 'panel.changed', state: next }).catch(() => undefined);
              },
            });
            const disconnect = observePublicPage(document, () => controller.navigate(location.href));
            controller.navigate(location.href);
            return { root, controller, disconnect, focus: () => (container.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) h1') ?? container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus() };
          },
          onRemove(mounted) { mounted?.controller.stop(); mounted?.disconnect(); mounted?.root.unmount(); },
        });
        if (!ctx.isValid || current !== generation) { created.remove(); return; }
        created.shadowHost.style.position = 'fixed';
        created.shadowHost.style.top = '12px';
        created.shadowHost.style.right = '12px';
        created.shadowHost.style.left = 'auto';
        ui = created;
        created.mount();
      })().finally(() => { if (opening === promise) opening = null; });
      opening = promise;
      return promise;
    }

    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => {
      if (!enabled || manuallyClosed) return;
      if (ui?.mounted) ui.mounted.controller.navigate(newUrl.href);
      else {
        const url = marketplaceUrl(newUrl.href);
        if (url && pageIdentity(url)) void open(false).catch(() => undefined);
      }
    });
    const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message: unknown, sender, respond) => {
      if (sender.id !== browser.runtime.id) return false;
      const preference = preferencesChangedSchema.safeParse(message);
      if (preference.success) {
        enabled = preference.data.preferences.panelEnabled;
        manuallyClosed = false;
        if (!enabled) close(false);
        else {
          const url = marketplaceUrl(location.href);
          if (url && pageIdentity(url)) void open(false).catch(() => undefined);
        }
        return false;
      }
      const request = panelRequestSchema.safeParse(message);
      if (!request.success) return false;
      void (async () => {
        if (request.data.operation === 'panel.open') {
          manuallyClosed = false;
          await open(true);
        } else if (request.data.operation === 'panel.refresh' && ui?.mounted) ui.mounted.controller.navigate(location.href);
        if (!ui?.mounted) state = snapshotState();
        respond({ version: PROTOCOL_VERSION, requestId: request.data.requestId, ok: true, data: state });
      })().catch(() => respond(errorResponse('internal', 'No se pudo abrir el panel.', request.data.requestId)));
      return true;
    };
    browser.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => { close(false); browser.runtime.onMessage.removeListener(listener); });
    void workerRequest('preferences.get').then((value) => {
      if (!ctx.isValid) return;
      enabled = preferencesSchema.parse(value).panelEnabled;
      const url = marketplaceUrl(location.href);
      if (enabled && url && pageIdentity(url)) return open(false);
    }).catch(() => undefined);
  },
});