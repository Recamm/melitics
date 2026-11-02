import { publicImageUrlSchema, publicPageSnapshotSchema, type ExtractionResult, type PublicPageSnapshot } from '../../shared/contracts';
import { parseMoney } from '../../shared/money';
import { ARGENTINA, cleanUrl, marketplaceUrl, normalizeId, pageIdentity } from './markets';

type JsonNode = Record<string, unknown>;
type Provenance = PublicPageSnapshot['provenance'];
type Source = NonNullable<Provenance['title']>['source'];

function node(value: unknown): JsonNode | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonNode : null;
}

function text(value: unknown, maximum = 500): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim().replace(/\s+/g, ' ');
  return result && result.length <= maximum ? result : null;
}

function hasType(value: JsonNode, expected: string): boolean {
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  return types.some((type) => type === expected || type === `https://schema.org/${expected}` || type === `http://schema.org/${expected}`);
}

function structuredNodes(document: Document): JsonNode[] {
  const nodes: JsonNode[] = [];
  function collect(value: unknown, depth = 0): void {
    if (depth > 8 || nodes.length >= 256) return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 256)) collect(entry, depth + 1);
      return;
    }
    const current = node(value);
    if (!current) return;
    nodes.push(current);
    if (current['@graph'] !== undefined) collect(current['@graph'], depth + 1);
  }
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 16)) {
    const content = script.textContent ?? '';
    if (content.length > 256_000) continue;
    try {
      collect(JSON.parse(content));
    } catch {
      continue;
    }
  }
  return nodes;
}

function reference(value: unknown, nodes: JsonNode[]): JsonNode | null {
  let current = node(value);
  const seen = new Set<JsonNode>();
  while (current && Object.keys(current).length === 1 && typeof current['@id'] === 'string') {
    if (seen.has(current)) return null;
    seen.add(current);
    const matches = nodes.filter((entry) => entry['@id'] === current?.['@id'] && entry !== current);
    if (matches.length !== 1) return null;
    current = matches[0] ?? null;
  }
  return current;
}

function productForPage(nodes: JsonNode[], identity: NonNullable<ReturnType<typeof pageIdentity>>, base: string): JsonNode | null {
  const products = nodes.filter((entry) => hasType(entry, 'Product'));
  const matching: JsonNode[] = [];
  const unidentified: JsonNode[] = [];
  for (const product of products) {
    const sku = normalizeId(product.sku);
    const productUrl = typeof product.url === 'string' ? marketplaceUrl(product.url, base) : null;
    const route = productUrl ? pageIdentity(productUrl) : null;
    const ownId = identity.productId ?? identity.listingId;
    if (sku && sku !== ownId && sku !== identity.listingId) continue;
    if (product.url !== undefined && (!route || (route.productId ?? route.listingId) !== ownId)) continue;
    if ((sku !== null && (sku === ownId || sku === identity.listingId))
      || (route && (route.productId ?? route.listingId) === ownId)) matching.push(product);
    else if (!sku && !product.url) unidentified.push(product);
  }
  if (matching.length === 1) return matching[0] ?? null;
  return products.length === 1 && unidentified.length === 1 ? unidentified[0] ?? null : null;
}

function publicSellerUrl(value: unknown, base: string): string | null {
  if (typeof value !== 'string') return null;
  const url = marketplaceUrl(value, base);
  return url && /^\/(?:perfil|tienda)\/[^/]+\/?$/i.test(url.pathname) ? cleanUrl(url) : null;
}

function publicImage(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : node(value)?.url ?? value;
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    url.search = '';
    url.hash = '';
    const parsed = publicImageUrlSchema.safeParse(url.href);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function extractPublicPage(document: Document, inputUrl: string): ExtractionResult {
  const url = marketplaceUrl(inputUrl);
  if (!url) return { status: 'unsupported', reason: 'unsupported-origin' };
  const identity = pageIdentity(url);
  if (!identity) return { status: 'unsupported', reason: 'unsupported-route' };

  let canonicalUrl = cleanUrl(url);
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const candidateUrl = canonical ? marketplaceUrl(canonical, canonicalUrl) : null;
  const candidateIdentity = candidateUrl ? pageIdentity(candidateUrl) : null;
  if (candidateUrl && candidateIdentity?.kind === identity.kind
    && (candidateIdentity.productId ?? candidateIdentity.listingId) === (identity.productId ?? identity.listingId)) {
    canonicalUrl = cleanUrl(candidateUrl);
  }

  const provenance: Provenance = { canonicalUrl: { source: 'url', url: canonicalUrl } };
  const mark = (field: keyof Provenance, source: Source): void => { provenance[field] = { source, url: canonicalUrl }; };
  if (identity.listingId) mark('listingId', 'url');
  if (identity.productId) mark('productId', 'url');
  const nodes = structuredNodes(document);
  const product = productForPage(nodes, identity, canonicalUrl);
  const rawOffers = product?.offers;
  const offers = (Array.isArray(rawOffers) ? rawOffers : [rawOffers])
    .map((value) => reference(value, nodes))
    .filter((value): value is JsonNode => value !== null && hasType(value, 'Offer'))
    .filter((offer) => {
      if (offer.url === undefined) return true;
      const offerUrl = typeof offer.url === 'string' ? marketplaceUrl(offer.url, canonicalUrl) : null;
      const route = offerUrl ? pageIdentity(offerUrl) : null;
      if (!route) return false;
      return identity.listingId ? route.listingId === identity.listingId
        : route.kind === 'listing' || route.productId === identity.productId;
    });
  const selectedOffers = offers.filter((offer) => {
    const offerUrl = typeof offer.url === 'string' ? marketplaceUrl(offer.url, canonicalUrl) : null;
    return offerUrl && identity.listingId && pageIdentity(offerUrl)?.listingId === identity.listingId;
  });
  const offer = selectedOffers.length === 1 ? selectedOffers[0] : offers.length === 1 ? offers[0] : undefined;
  const meta = (selector: string): string | null => text(document.querySelector(selector)?.getAttribute('content'));
  let imageUrl = publicImage(product?.image);
  if (imageUrl) mark('imageUrl', 'json-ld');
  else {
    imageUrl = publicImage(meta('meta[property="og:image"]'));
    if (imageUrl) mark('imageUrl', 'meta');
  }
  let title = text(product?.name);
  if (title) mark('title', 'json-ld');
  else {
    title = meta('meta[property="og:title"]') ?? meta('meta[name="twitter:title"]');
    if (title) mark('title', 'meta');
    else {
      title = text(document.querySelector('.ui-pdp-title')?.textContent);
      if (title) mark('title', 'dom');
    }
  }

  let price = offer && typeof offer.priceCurrency === 'string'
    ? parseMoney(offer.price, { currency: offer.priceCurrency, locale: ARGENTINA.locale, format: 'machine' }) : null;
  if (price) mark('price', 'json-ld');
  else {
    price = parseMoney(meta('meta[property="product:price:amount"]') ?? meta('meta[itemprop="price"]'), {
      currency: meta('meta[property="product:price:currency"]') ?? meta('meta[itemprop="priceCurrency"]') ?? '',
      locale: ARGENTINA.locale, format: 'machine',
    });
    if (price) mark('price', 'meta');
    else {
      const amount = document.querySelector('.ui-pdp-price__second-line .andes-money-amount');
      const fraction = text(amount?.querySelector('.andes-money-amount__fraction')?.textContent);
      const cents = text(amount?.querySelector('.andes-money-amount__cents')?.textContent);
      const symbol = text(amount?.querySelector('.andes-money-amount__currency-symbol')?.textContent);
      const currency = symbol === '$' ? ARGENTINA.currency : symbol === 'US$' || symbol === 'U$S' ? 'USD' : '';
      price = parseMoney(fraction ? `${fraction}${cents ? `,${cents}` : ''}` : null, {
        currency, locale: ARGENTINA.locale, format: 'localized',
      });
      if (price) mark('price', 'dom');
    }
  }

  const structuredSeller = reference(offer?.seller, nodes);
  let sellerName = text(structuredSeller?.name, 200);
  let sellerUrl = publicSellerUrl(structuredSeller?.url, canonicalUrl);
  const identifier = structuredSeller?.identifier;
  const sellerId = typeof identifier === 'string' && /^[1-9][0-9]{0,19}$/.test(identifier) ? identifier : null;
  if (sellerName) mark('seller.name', 'json-ld');
  if (sellerUrl) mark('seller.url', 'json-ld');
  if (sellerId) mark('seller.id', 'json-ld');
  if (!sellerName && !sellerId && !sellerUrl) {
    const link = document.querySelector('a.ui-pdp-seller__link-trigger');
    const safeUrl = publicSellerUrl(link?.getAttribute('href'), canonicalUrl);
    if (safeUrl) {
      sellerName = text(link?.textContent, 200);
      sellerUrl = safeUrl;
      if (sellerName) mark('seller.name', 'dom');
      mark('seller.url', 'dom');
    }
  }

  const snapshot = publicPageSnapshotSchema.parse({
    siteId: ARGENTINA.siteId, locale: ARGENTINA.locale,
    canonicalUrl, ...identity, title, price, imageUrl,
    seller: sellerName || sellerUrl || sellerId ? { id: sellerId, name: sellerName, url: sellerUrl } : null,
    observedAt: new Date().toISOString(), extractorRevision: 'public-v1', provenance,
  });
  return { status: title && price && sellerName ? 'complete' : 'partial', snapshot };
}