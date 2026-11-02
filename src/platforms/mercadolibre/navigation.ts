import type { ExtractionResult, PanelState } from '../../shared/contracts';

export function observePublicPage(document: Document, changed: () => void): () => void {
  const selector = '.ui-pdp-title, .ui-pdp-price__second-line, .ui-pdp-seller__link-trigger, script[type="application/ld+json"], meta[property^="product:"], meta[property^="og:"], link[rel="canonical"]';
  const relevant = (element: Element): boolean => !element.closest('meli-extension-panel')
    && (element.matches(selector) || element.closest(selector) !== null || element.querySelector(selector) !== null);
  const publicRoot = () => document.querySelector('.ui-pdp-container') ?? document.querySelector('main') ?? document.body;
  let root: Element = publicRoot();
  const observer = new MutationObserver((records) => {
    const nextRoot = publicRoot();
    if (nextRoot !== root) { connect(nextRoot); changed(); return; }
    if (records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest('meli-extension-panel')) return false;
      if (target?.matches(selector) || target?.closest(selector)) return true;
      return [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element && relevant(node));
    })) changed();
  });
  const options = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['content', 'href', 'src'] };
  function connect(nextRoot: Element): void {
    observer.disconnect();
    root = nextRoot;
    observer.observe(root, options);
    observer.observe(document.head, options);
    for (let parent = root === document.body ? null : root.parentElement; parent; parent = parent.parentElement) {
      observer.observe(parent, { childList: true });
      if (parent === document.body) break;
    }
  }
  connect(root);
  return () => observer.disconnect();
}

export function createNavigationController(options: {
  extract: (url: string, signal: AbortSignal) => ExtractionResult | Promise<ExtractionResult>;
  publish: (state: PanelState) => void;
}) {
  let state: PanelState = { status: 'loading', snapshot: null, stale: false, message: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  let generation = 0;
  let stopped = false;

  function publish(next: PanelState): void {
    state = next;
    options.publish(next);
  }

  async function extract(url: string, current: number, signal: AbortSignal): Promise<void> {
    try {
      const result = await options.extract(url, signal);
      if (stopped || signal.aborted || current !== generation) return;
      publish(result.status === 'unsupported'
        ? { status: 'unsupported', snapshot: null, stale: false, message: 'Publicacion no compatible.' }
        : { status: 'ready', snapshot: result.snapshot, stale: false, message: null });
    } catch {
      if (stopped || signal.aborted || current !== generation) return;
      publish({ status: 'error', snapshot: state.snapshot, stale: state.snapshot !== null, message: 'No se pudieron actualizar los datos.' });
    }
  }

  return {
    navigate: (url: string): void => {
      if (stopped) return;
      generation += 1;
      const current = generation;
      active?.abort();
      if (timer !== undefined) clearTimeout(timer);
      publish({ status: 'loading', snapshot: state.snapshot, stale: state.snapshot !== null, message: null });
      active = new AbortController();
      const signal = active.signal;
      timer = setTimeout(() => { void extract(url, current, signal); }, 200);
    },
    stop: (): void => {
      stopped = true;
      generation += 1;
      active?.abort();
      if (timer !== undefined) clearTimeout(timer);
    },
    getState: (): PanelState => state,
  };
}