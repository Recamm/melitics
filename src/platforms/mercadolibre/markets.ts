export const ARGENTINA = {
  siteId: 'MLA',
  locale: 'es-AR',
  currency: 'ARS',
  domain: 'mercadolibre.com.ar',
} as const;

export function marketplaceUrl(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname !== ARGENTINA.domain && !url.hostname.endsWith(`.${ARGENTINA.domain}`)) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^MLA-?([1-9][0-9]{4,19})$/i.exec(value.trim());
  return match ? `MLA${match[1]}` : null;
}

export function pageIdentity(url: URL): {
  kind: 'listing' | 'catalog';
  listingId: string | null;
  productId: string | null;
} | null {
  const catalog = /^\/(?:[^/]+\/)?p\/(MLA[1-9][0-9]{4,19})\/?$/i.exec(url.pathname);
  if (catalog) {
    const productId = normalizeId(catalog[1]);
    const selections = (url.searchParams.get('pdp_filters') ?? '').split(',')
      .map((filter) => /^item_id:(MLA[1-9][0-9]{4,19})$/i.exec(filter)?.[1])
      .filter((value): value is string => value !== undefined);
    const selected = selections.length === 1 ? normalizeId(selections[0]) : null;
    return { kind: 'catalog', productId, listingId: selected === productId ? null : selected };
  }
  const listing = /^\/(MLA-[1-9][0-9]{4,19})(?:-[^/]+)?\/?$/i.exec(url.pathname);
  return listing ? { kind: 'listing', listingId: normalizeId(listing[1]), productId: null } : null;
}

export function cleanUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}