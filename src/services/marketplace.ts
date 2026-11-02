import { z } from 'zod';
import { marketplaceIdSchema, marketplacePageSchema, marketplaceResultSchema, type ErrorCode, type MarketplaceResult, type OfferSnapshot, type BuyboxObservation } from '../shared/contracts';

export type AuthorizedMarketplaceSource = {
  authorization: 'approved'; id: string; documentationUrl: string;
  loadPage: (request: { productId: string; cursor: string | null; signal: AbortSignal }) => Promise<Response>;
};

export class MarketplaceError extends Error {
  constructor(public readonly code: ErrorCode) { super('No se pudo completar la consulta autorizada.'); }
}

export function createMarketplaceService(source?: AuthorizedMarketplaceSource) {
  return { async offers(productId: string, signal: AbortSignal): Promise<MarketplaceResult> {
    marketplaceIdSchema.parse(productId);
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (!source || source.authorization !== 'approved') return { status: 'unavailable', reason: 'no-authorized-source', offers: [], buybox: [] };
    z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(source.id);
    z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }).parse(source.documentationUrl);
    const controller = new AbortController();
    const cancel = () => controller.abort(new DOMException('Request cancelled', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    const deadline = Date.now() + 10000;
    const timeout = setTimeout(() => controller.abort(new MarketplaceError('timeout')), 10000);
    const aborted = new Promise<never>((_resolve, reject) => { controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }); });
    void aborted.catch(() => undefined);
    async function guarded<Value>(promise: Promise<Value>): Promise<Value> {
      if (controller.signal.aborted) throw controller.signal.reason;
      return Promise.race([promise, aborted]);
    }
    async function wait(delay: number): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await guarded(new Promise<void>(resolve => { timer = setTimeout(resolve, delay); })); }
      finally { clearTimeout(timer); }
    }
    try {
      const offers: OfferSnapshot[] = []; const buybox: BuyboxObservation[] = [];
      const cursors = new Set<string>(); let cursor: string | null = null;
      for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try { response = await guarded(source.loadPage({ productId, cursor, signal: controller.signal })); }
          catch (error) {
            if (!(error instanceof TypeError) || attempt === 2) throw error;
            await wait(250 * 2 ** attempt); continue;
          }
          if (response.ok) break;
          if (response.status === 401 || response.status === 403) throw new MarketplaceError('forbidden');
          const transient = [429, 500, 502, 503, 504].includes(response.status);
          if (!transient || attempt === 2) throw new MarketplaceError(response.status === 429 ? 'rate-limited' : 'unavailable');
          const header = response.headers.get('Retry-After');
          let delay = 250 * 2 ** attempt;
          if (header !== null) {
            delay = /^\d+$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - Date.now();
            if (!Number.isFinite(delay) || delay < 0) throw new MarketplaceError(response.status === 429 ? 'rate-limited' : 'unavailable');
          } else if (response.status === 429) throw new MarketplaceError('rate-limited');
          if (delay >= deadline - Date.now()) throw new MarketplaceError(response.status === 429 ? 'rate-limited' : 'unavailable');
          await wait(delay);
        }
        if (!response?.ok) throw new MarketplaceError('unavailable');
        const page = marketplacePageSchema.parse(await guarded(response.json()));
        if ([...page.offers, ...page.buybox].some(item => item.productId !== productId || item.source.kind !== 'authorized-api')) throw new MarketplaceError('invalid-input');
        offers.push(...page.offers); buybox.push(...page.buybox);
        if (offers.length > 500 || buybox.length > 50000) throw new MarketplaceError('invalid-input');
        if (page.nextCursor === null) return marketplaceResultSchema.parse({ status: 'ready', sourceId: source.id, offers, buybox });
        if (cursors.has(page.nextCursor)) throw new MarketplaceError('invalid-input');
        cursors.add(page.nextCursor); cursor = page.nextCursor;
      }
      throw new MarketplaceError('invalid-input');
    } catch (error) {
      if (error instanceof MarketplaceError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      throw new MarketplaceError(error instanceof z.ZodError || error instanceof SyntaxError ? 'invalid-input' : 'unavailable');
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  } };
}