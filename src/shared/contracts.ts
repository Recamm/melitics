import { z } from 'zod';

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
  completedMilestone: z.literal(3),
  mode: z.literal('local'),
  networkEnabled: z.literal(false),
  capabilities: z.strictObject({
    analysis: z.literal('available'),
    history: z.literal('unavailable'),
    assistant: z.literal('disabled'),
  }),
});

export const RUNTIME_STATUS: z.infer<typeof runtimeStatusSchema> = {
  completedMilestone: 3,
  mode: 'local',
  networkEnabled: false,
  capabilities: {
    analysis: 'available',
    history: 'unavailable',
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