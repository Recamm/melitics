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
  completedMilestone: z.literal(5),
  mode: z.literal('local'),
  networkEnabled: z.literal(false),
  capabilities: z.strictObject({
    analysis: z.literal('available'),
    profitability: z.literal('available'),
    history: z.literal('available'),
    assistant: z.literal('disabled'),
  }),
});

export const RUNTIME_STATUS: z.infer<typeof runtimeStatusSchema> = {
  completedMilestone: 5,
  mode: 'local',
  networkEnabled: false,
  capabilities: {
    analysis: 'available',
    profitability: 'available',
    history: 'available',
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