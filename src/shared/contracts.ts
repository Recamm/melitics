import { z } from 'zod';
import { marketplaceUrl, pageIdentity } from '../platforms/mercadolibre/markets';

export const currencySchema = z.enum(['ARS', 'BRL', 'CLP', 'USD']);
export const CURRENCY_EXPONENTS = { ARS: 2, BRL: 2, CLP: 0, USD: 2 } as const;

export const moneySchema = z.strictObject({
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: currencySchema,
  exponent: z.number().int().min(0).max(2),
}).refine((money) => money.exponent === CURRENCY_EXPONENTS[money.currency], {
  message: 'Currency exponent mismatch',
});

export type Money = z.infer<typeof moneySchema>;

export const signedMoneySchema = z.strictObject({
  ...moneySchema.shape,
  amountMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
}).refine((money) => money.exponent === CURRENCY_EXPONENTS[money.currency]);

export type SignedMoney = z.infer<typeof signedMoneySchema>;
export const FEE_MONEY_FIELDS = ['price', 'cost', 'fixedFee', 'shipping', 'taxes', 'financing'] as const;
export const FEE_FIELDS = [...FEE_MONEY_FIELDS, 'commissionBps'] as const;
export const feeRulesSchema = z.strictObject({
  source: z.literal('manual'),
  version: z.literal('manual-half-up-v1'),
  observedAt: z.iso.datetime(),
});

export const feeScenarioSchema = z.strictObject({
  currency: currencySchema,
  price: moneySchema.nullable(),
  cost: moneySchema.nullable(),
  commissionBps: z.number().int().min(0).max(1000000).nullable(),
  fixedFee: moneySchema.nullable(),
  shipping: moneySchema.nullable(),
  taxes: moneySchema.nullable(),
  financing: moneySchema.nullable(),
  rules: feeRulesSchema,
}).superRefine((scenario, context) => {
  for (const field of FEE_MONEY_FIELDS) {
    if (scenario[field] && scenario[field].currency !== scenario.currency) {
      context.addIssue({ code: 'custom', path: [field], message: 'Currency mismatch' });
    }
  }
});

export type FeeScenario = z.infer<typeof feeScenarioSchema>;
export const feeResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('complete'),
    commission: moneySchema, deductions: moneySchema,
    payout: signedMoneySchema, profit: signedMoneySchema,
    marginBps: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable(),
    returnOnCostBps: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable(),
    breakEven: moneySchema.nullable(),
    rules: feeRulesSchema,
  }),
  z.strictObject({
    status: z.literal('incomplete'),
    missing: z.array(z.enum(FEE_FIELDS)).min(1),
    rules: feeRulesSchema,
  }),
  z.strictObject({ status: z.literal('invalid'), reason: z.enum(['invalid-scenario', 'overflow']) }),
]);

export type FeeResult = z.infer<typeof feeResultSchema>;

export const publicImageUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && (url.hostname === 'mlstatic.com' || url.hostname.endsWith('.mlstatic.com'))
    && !url.search && !url.hash;
});

export const publicPageSnapshotSchema = z.strictObject({
  siteId: z.literal('MLA'),
  locale: z.literal('es-AR'),
  canonicalUrl: z.url(),
  kind: z.enum(['listing', 'catalog']),
  listingId: z.string().regex(/^MLA[1-9][0-9]{4,19}$/).nullable(),
  productId: z.string().regex(/^MLA[1-9][0-9]{4,19}$/).nullable(),
  title: z.string().min(1).max(500).nullable(),
  price: moneySchema.nullable(),
  imageUrl: publicImageUrlSchema.nullable().default(null),
  seller: z.strictObject({
    id: z.string().regex(/^[1-9][0-9]{0,19}$/).nullable(),
    name: z.string().min(1).max(200).nullable(),
    url: z.url().nullable(),
  }).nullable(),
  observedAt: z.iso.datetime(),
  extractorRevision: z.literal('public-v1'),
  provenance: z.partialRecord(z.enum([
    'canonicalUrl', 'listingId', 'productId', 'title', 'price', 'imageUrl',
    'seller.id', 'seller.name', 'seller.url',
  ]), z.strictObject({ source: z.enum(['url', 'json-ld', 'meta', 'dom']), url: z.url() })),
}).refine((snapshot) => snapshot.kind === 'listing' ? snapshot.listingId !== null : snapshot.productId !== null)
  .refine((snapshot) => snapshot.listingId === null || snapshot.productId !== snapshot.listingId);

export type PublicPageSnapshot = z.infer<typeof publicPageSnapshotSchema>;

export const marketplaceIdSchema = z.string().regex(/^MLA[1-9][0-9]{4,19}$/);
export const publicSellerIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const offerSourceSchema = z.strictObject({
  kind: z.enum(['public-page', 'authorized-api']),
  url: z.url().max(2048).refine(value => {
    const url = marketplaceUrl(value); return !!url && !url.search && !url.hash && pageIdentity(url) !== null;
  }),
  observedAt: z.iso.datetime().transform(value => new Date(value).toISOString()),
});
export const paymentSegmentSchema = z.enum(['direct', 'installments-interest-free', 'installments-with-interest', 'unknown']);
export type PaymentSegment = z.infer<typeof paymentSegmentSchema>;
export const offerSnapshotSchema = z.strictObject({
  siteId: z.literal('MLA'), productId: marketplaceIdSchema, listingId: marketplaceIdSchema,
  sellerId: publicSellerIdSchema.nullable(), sellerName: z.string().min(1).max(200).nullable(),
  price: moneySchema.nullable(),
  installments: z.strictObject({ count: z.number().int().min(1).max(48).nullable(), interest: z.enum(['interest-free', 'with-interest', 'unknown']), total: moneySchema.nullable() }),
  shipping: z.strictObject({ full: z.boolean().nullable(), free: z.boolean().nullable(), cost: moneySchema.nullable() }),
  winner: z.boolean().nullable(), source: offerSourceSchema,
}).refine(offer => {
  const url = marketplaceUrl(offer.source.url); const identity = url && pageIdentity(url);
  const sameMoney = [offer.installments.total, offer.shipping.cost].every(money => !money || !offer.price || (money.currency === offer.price.currency && money.exponent === offer.price.exponent));
  const total = offer.installments.total?.amountMinor;
  return offer.productId !== offer.listingId && identity
    && (identity.kind === 'catalog' ? identity.productId === offer.productId : identity.listingId === offer.listingId)
    && sameMoney && !(offer.shipping.free === true && (offer.shipping.cost?.amountMinor ?? 0) !== 0)
    && !(offer.shipping.free === false && offer.shipping.cost?.amountMinor === 0)
    && !(offer.installments.count === 1 && offer.installments.interest === 'with-interest')
    && (total === undefined || !offer.price || (offer.installments.interest === 'interest-free' ? total === offer.price.amountMinor : total >= offer.price.amountMinor));
});
export type OfferSnapshot = z.infer<typeof offerSnapshotSchema>;
export const buyboxObservationSchema = z.strictObject({
  siteId: z.literal('MLA'), productId: marketplaceIdSchema, currency: currencySchema,
  segment: paymentSegmentSchema.exclude(['unknown']), winnerListingId: marketplaceIdSchema.nullable(),
  source: offerSourceSchema,
}).refine(observation => {
  const url = marketplaceUrl(observation.source.url); const identity = url && pageIdentity(url);
  return identity && identity.kind === 'catalog' && identity.productId === observation.productId && observation.winnerListingId !== observation.productId;
});
export type BuyboxObservation = z.infer<typeof buyboxObservationSchema>;
export const buyboxSummarySchema = z.strictObject({
  knownSamples: z.number().int().min(0), unknownSamples: z.number().int().min(0), wins: z.number().int().min(0),
  winBps: z.number().int().min(0).max(10000).nullable(), firstAt: z.iso.datetime().nullable(), lastAt: z.iso.datetime().nullable(),
  observedDays: z.number().int().min(0).max(90), periodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});
export type BuyboxSummary = z.infer<typeof buyboxSummarySchema>;

export function sellerContactKey(contact: { sellerId: string; field: 'profile'; value: string }): string { return JSON.stringify(['MLA', contact.sellerId, contact.field, contact.value]); }
export const sellerContactSchema = z.strictObject({
  key: z.string().min(1).max(2300), siteId: z.literal('MLA'), sellerId: publicSellerIdSchema,
  field: z.literal('profile'), value: z.url().max(2048).refine(value => {
    const url = marketplaceUrl(value); return !!url && !url.search && !url.hash && /^\/(?:perfil|tienda)\/[^/]+\/?$/i.test(url.pathname);
  }),
  sourceUrl: offerSourceSchema.shape.url,
  observedAt: offerSourceSchema.shape.observedAt, expiresAt: offerSourceSchema.shape.observedAt,
  verification: z.literal('unconfirmed'),
}).refine(contact => contact.key === sellerContactKey(contact) && Date.parse(contact.expiresAt) === Date.parse(contact.observedAt) + 30 * 86400000);
export type SellerContact = z.infer<typeof sellerContactSchema>;
export const marketplaceResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unavailable'), reason: z.literal('no-authorized-source'), offers: z.array(z.never()), buybox: z.array(z.never()) }),
  z.strictObject({ status: z.literal('ready'), sourceId: z.string().min(1).max(100), offers: z.array(offerSnapshotSchema).max(500), buybox: z.array(buyboxObservationSchema).max(50000) }),
]);
export type MarketplaceResult = z.infer<typeof marketplaceResultSchema>;
export const marketplacePageSchema = z.strictObject({
  offers: z.array(offerSnapshotSchema).max(500), buybox: z.array(buyboxObservationSchema).max(50000), nextCursor: z.string().min(1).max(256).nullable(),
});

export const publicationKeySchema = z.string().regex(/^MLA:(listing|catalog):MLA[1-9][0-9]{4,19}$/);

function safeHistoryUrl(value: string): boolean {
  const url = marketplaceUrl(value);
  return value.length <= 2048 && !!url && !url.search && !url.hash && value === `${url.origin}${url.pathname}`;
}

export const historySnapshotSchema = publicPageSnapshotSchema.safeExtend({ observedAt: z.iso.datetime().transform(value => new Date(value).toISOString()) }).refine((snapshot) => {
  const url = marketplaceUrl(snapshot.canonicalUrl);
  const identity = url && pageIdentity(url);
  const sellerUrl = snapshot.seller?.url ? marketplaceUrl(snapshot.seller.url) : null;
  return identity && safeHistoryUrl(snapshot.canonicalUrl) && identity.kind === snapshot.kind
    && (identity.kind === 'listing' ? identity.listingId === snapshot.listingId : identity.productId === snapshot.productId)
    && (!snapshot.imageUrl || snapshot.imageUrl.length <= 2048)
    && (!snapshot.seller?.url || (safeHistoryUrl(snapshot.seller.url) && sellerUrl && /^\/(?:perfil|tienda)\/[^/]+\/?$/i.test(sellerUrl.pathname)))
    && Object.values(snapshot.provenance).every((field) => {
      if (!field) return true;
      const sourceUrl = marketplaceUrl(field.url); const source = sourceUrl && pageIdentity(sourceUrl);
      return safeHistoryUrl(field.url) && source && (source.kind === 'listing' ? source.listingId === snapshot.listingId : source.productId === snapshot.productId);
    });
});

export function publicationKey(snapshot: PublicPageSnapshot): string {
  return `MLA:${snapshot.listingId ? 'listing' : 'catalog'}:${snapshot.listingId ?? snapshot.productId}`;
}

export const followedPublicationSchema = z.strictObject({
  key: publicationKeySchema,
  snapshot: historySnapshotSchema,
  following: z.boolean(),
  followedAt: z.iso.datetime(),
}).refine((publication) => publication.key === publicationKey(publication.snapshot));

export type FollowedPublication = z.infer<typeof followedPublicationSchema>;
export const priceObservationSchema = z.strictObject({
  id: z.string().min(1).max(512),
  publicationKey: publicationKeySchema,
  snapshot: historySnapshotSchema,
}).refine((observation) => observation.publicationKey === publicationKey(observation.snapshot) && observation.id === observationId(observation.snapshot));

export type PriceObservation = z.infer<typeof priceObservationSchema>;
export function observationId(snapshot: PublicPageSnapshot): string {
  return JSON.stringify([publicationKey(snapshot), snapshot.observedAt, snapshot.price?.currency ?? null,
    snapshot.provenance.price?.source ?? snapshot.extractorRevision]);
}

export const historyDataSchema = z.strictObject({
  publication: followedPublicationSchema.nullable(),
  observations: z.array(priceObservationSchema).max(50000),
});
export type HistoryData = z.infer<typeof historyDataSchema>;

export const historyArchiveSchema = z.strictObject({
  schemaVersion: z.literal(1), exportedAt: z.iso.datetime(),
  publications: z.array(followedPublicationSchema).max(100),
  observations: z.array(priceObservationSchema).max(50000),
}).refine((archive) => {
  const keys = new Set(archive.publications.map(publication => publication.key));
  return keys.size === archive.publications.length && archive.observations.every(observation => keys.has(observation.publicationKey));
});
export type HistoryArchive = z.infer<typeof historyArchiveSchema>;
export const historyInfoSchema = z.strictObject({
  publicationCount: z.number().int().min(0).max(100), observationCount: z.number().int().min(0).max(50000),
  publicationLimit: z.literal(100), observationLimit: z.literal(50000),
  retentionDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  contactCount: z.number().int().min(0).max(1000).optional(),
});
export type HistoryInfo = z.infer<typeof historyInfoSchema>;

export const extractionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.enum(['complete', 'partial']),
    snapshot: publicPageSnapshotSchema,
  }),
  z.strictObject({
    status: z.literal('unsupported'),
    reason: z.enum(['unsupported-origin', 'unsupported-route']),
  }),
]);

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const panelStateSchema = z.strictObject({
  status: z.enum(['loading', 'ready', 'error', 'unsupported']),
  snapshot: publicPageSnapshotSchema.nullable(),
  stale: z.boolean(),
  message: z.string().max(160).nullable(),
});

export type PanelState = z.infer<typeof panelStateSchema>;

export const PROTOCOL_VERSION = 1;

export const preferencesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  panelEnabled: z.boolean(),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  schemaVersion: 1,
  panelEnabled: true,
};

export const runtimeStatusSchema = z.strictObject({
  completedMilestone: z.literal(6),
  mode: z.literal('local'),
  networkEnabled: z.literal(false),
  capabilities: z.strictObject({
    analysis: z.literal('available'),
    profitability: z.literal('available'),
    history: z.literal('available'),
    catalogComparison: z.literal('available'),
    catalog: z.literal('unavailable'),
    buybox: z.literal('unavailable'),
    contacts: z.literal('available'),
    assistant: z.literal('disabled'),
  }),
});

export const RUNTIME_STATUS: z.infer<typeof runtimeStatusSchema> = {
  completedMilestone: 6,
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
};

export const errorCodeSchema = z.enum([
  'invalid-input',
  'forbidden',
  'unsupported',
  'unavailable',
  'timeout',
  'rate-limited',
  'storage-full',
  'internal',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;