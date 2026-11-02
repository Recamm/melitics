import { z } from 'zod';
import type { HistoryStore } from '../background/store';
import { marketplaceUrl, pageIdentity } from '../platforms/mercadolibre/markets';
import {
  historyArchiveSchema, historyDataSchema, historyInfoSchema, historySnapshotSchema,
  followedPublicationSchema, publicationKeySchema,
  errorCodeSchema,
  preferencesSchema,
  PROTOCOL_VERSION,
  RUNTIME_STATUS,
  runtimeStatusSchema,
  panelStateSchema,
  type ErrorCode,
  type Preferences,
} from '../shared/contracts';

const requestBase = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  requestId: z.uuid(),
});

export const requestSchema = z.discriminatedUnion('operation', [
  requestBase.extend({ operation: z.enum(['status.get', 'preferences.get']), payload: z.strictObject({}) }),
  requestBase.extend({ operation: z.literal('preferences.set'), payload: z.strictObject({ panelEnabled: z.boolean() }) }),
]);

export const responseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    version: z.literal(PROTOCOL_VERSION),
    requestId: z.uuid(),
    ok: z.literal(true),
    data: z.union([runtimeStatusSchema, preferencesSchema]),
  }),
  z.strictObject({
    version: z.literal(PROTOCOL_VERSION),
    requestId: z.uuid().nullable(),
    ok: z.literal(false),
    error: z.strictObject({
      code: errorCodeSchema,
      message: z.string().max(160),
    }),
  }),
]);

export type MessageRequest = z.infer<typeof requestSchema>;
export type MessageResponse = z.infer<typeof responseSchema>;

export const panelRequestSchema = requestBase.extend({
  operation: z.enum(['panel.get', 'panel.open', 'panel.refresh']),
  payload: z.strictObject({}),
});
export type PanelOperation = z.infer<typeof panelRequestSchema>['operation'];
export const panelResponseSchema = z.union([
  z.strictObject({ version: z.literal(PROTOCOL_VERSION), requestId: z.uuid(), ok: z.literal(true), data: panelStateSchema }),
  responseSchema.options[1],
]);
export const panelChangedSchema = z.strictObject({ type: z.literal('panel.changed'), state: panelStateSchema });
export const preferencesChangedSchema = z.strictObject({ type: z.literal('preferences.changed'), preferences: preferencesSchema });

const senderSchema = z.looseObject({
  id: z.string(),
  url: z.string(),
  origin: z.string().optional(),
  frameId: z.number().int().nonnegative().optional(),
  documentLifecycle: z.string().optional(),
  tab: z.looseObject({ id: z.number().int().nonnegative() }).optional(),
});

function isTrustedSender(sender: unknown, extensionId: string): boolean {
  const parsed = senderSchema.safeParse(sender);
  if (!parsed.success || parsed.data.id !== extensionId) return false;
  const context = parsed.data;
  if (context.documentLifecycle !== undefined && context.documentLifecycle !== 'active') {
    return false;
  }

  try {
    const url = new URL(context.url);
    if (url.username || url.password || url.port) return false;

    if (url.protocol === 'chrome-extension:' && url.hostname === extensionId) {
      return context.origin === undefined || context.origin === `chrome-extension://${extensionId}`;
    }

    return url.protocol === 'https:'
      && (url.hostname === 'mercadolibre.com.ar' || url.hostname.endsWith('.mercadolibre.com.ar'))
      && context.frameId === 0
      && context.tab !== undefined
      && (context.origin === undefined || context.origin === url.origin);
  } catch {
    return false;
  }
}

export const historyRequestSchema = z.discriminatedUnion('operation', [
  requestBase.extend({ operation: z.literal('history.manage'), payload: z.strictObject({ key: publicationKeySchema.nullable() }) }),
  requestBase.extend({ operation: z.enum(['history.list', 'history.export', 'history.info']), payload: z.strictObject({}) }),
  requestBase.extend({ operation: z.enum(['history.read', 'history.unfollow']), payload: z.strictObject({ key: publicationKeySchema }) }),
  requestBase.extend({ operation: z.enum(['history.follow', 'history.capture']), payload: z.strictObject({ snapshot: historySnapshotSchema }) }),
  requestBase.extend({ operation: z.literal('history.import'), payload: z.strictObject({ archive: historyArchiveSchema }) }),
  requestBase.extend({ operation: z.literal('history.prune'), payload: z.strictObject({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]), confirmed: z.literal(true) }) }),
  requestBase.extend({ operation: z.literal('history.remove'), payload: z.strictObject({ key: publicationKeySchema, confirmed: z.literal(true) }) }),
  requestBase.extend({ operation: z.literal('history.clear'), payload: z.strictObject({ confirmed: z.literal(true) }) }),
]);
export type HistoryRequest = z.infer<typeof historyRequestSchema>;
export const historyResponseDataSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('data'), ...historyDataSchema.shape }),
  z.strictObject({ kind: z.literal('list'), publications: z.array(followedPublicationSchema).max(100) }),
  z.strictObject({ kind: z.literal('archive'), archive: historyArchiveSchema }),
  z.strictObject({ kind: z.literal('info'), ...historyInfoSchema.shape }),
  z.strictObject({ kind: z.literal('capture'), status: z.enum(['recorded', 'duplicate', 'not-following']) }),
  z.strictObject({ kind: z.literal('merged'), imported: z.number().int().min(0).max(50000), duplicates: z.number().int().min(0).max(50000) }),
  z.strictObject({ kind: z.literal('pruned'), removed: z.number().int().min(0).max(50000) }),
  z.strictObject({ kind: z.literal('done') }),
]);
export const historyResponseSchema = z.union([
  z.strictObject({ version: z.literal(PROTOCOL_VERSION), requestId: z.uuid(), ok: z.literal(true), data: historyResponseDataSchema }),
  responseSchema.options[1],
]);

export function createHistoryMessageHandler(options: { extensionId: string; history: HistoryStore; open?: (key: string | null) => Promise<void> }) {
  return async (message: unknown, sender: unknown): Promise<z.infer<typeof historyResponseSchema>> => {
    if (!isTrustedSender(sender, options.extensionId)) return errorResponse('forbidden', 'Emisor no autorizado.');
    const parsed = historyRequestSchema.safeParse(message);
    if (!parsed.success) return errorResponse('invalid-input', 'Mensaje de historial no valido.');
    const request = parsed.data;
    const context = senderSchema.parse(sender);
    if (new URL(context.url).protocol !== 'chrome-extension:' && request.operation !== 'history.manage') {
      const url = marketplaceUrl(context.url); const identity = url && pageIdentity(url);
      const key = identity ? `MLA:${identity.listingId ? 'listing' : 'catalog'}:${identity.listingId ?? identity.productId}` : null;
      const authorized = identity && (
        ((request.operation === 'history.read' || request.operation === 'history.unfollow') && request.payload.key === key)
        || ((request.operation === 'history.follow' || request.operation === 'history.capture')
          && request.payload.snapshot.kind === identity.kind && request.payload.snapshot.listingId === identity.listingId
          && request.payload.snapshot.productId === identity.productId));
      if (!authorized) return errorResponse('forbidden', 'Operacion no autorizada.', request.requestId);
    }
    try {
      const store = options.history;
      let data: z.infer<typeof historyResponseDataSchema>;
      switch (request.operation) {
        case 'history.manage':
          if (!options.open) return errorResponse('unsupported', 'Gestion no disponible.', request.requestId);
          await options.open(request.payload.key); data = { kind: 'done' }; break;
        case 'history.read': data = { kind: 'data', ...await store.read(request.payload.key) }; break;
        case 'history.list': data = { kind: 'list', publications: await store.list() }; break;
        case 'history.info': data = { kind: 'info', ...await store.info() }; break;
        case 'history.export': data = { kind: 'archive', archive: await store.archive() }; break;
        case 'history.import': data = { kind: 'merged', ...await store.merge(request.payload.archive) }; break;
        case 'history.capture': data = { kind: 'capture', ...await store.record(request.payload.snapshot) }; break;
        case 'history.follow': await store.follow(request.payload.snapshot); data = { kind: 'done' }; break;
        case 'history.unfollow': await store.unfollow(request.payload.key); data = { kind: 'done' }; break;
        case 'history.prune': data = { kind: 'pruned', ...await store.prune(request.payload.days, request.payload.confirmed) }; break;
        case 'history.remove': await store.remove(request.payload.key, request.payload.confirmed); data = { kind: 'done' }; break;
        case 'history.clear': await store.clear(request.payload.confirmed); data = { kind: 'done' }; break;
      }
      return { version: PROTOCOL_VERSION, requestId: request.requestId, ok: true, data: historyResponseDataSchema.parse(data) };
    } catch (error) {
      const code = error instanceof z.ZodError ? 'invalid-input' : error && typeof error === 'object' && 'code' in error
        && ['storage-full', 'invalid-input', 'forbidden'].includes(String(error.code)) ? error.code as ErrorCode : 'internal';
      return errorResponse(code, code === 'storage-full' ? 'Sin espacio. Exporta o elimina datos antes de reintentar.' : 'No se pudo completar la operacion de historial.', request.requestId);
    }
  };
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  requestId: string | null = null,
): Extract<MessageResponse, { ok: false }> {
  return { version: PROTOCOL_VERSION, requestId, ok: false, error: { code, message } };
}

export function createMessageHandler(options: {
  extensionId: string;
  initialize: () => Promise<Preferences>;
  save?: (preferences: Preferences) => Promise<void>;
}) {
  let preferences: Promise<Preferences> | undefined;
  let writes: Promise<void> = Promise.resolve();

  function loadPreferences(): Promise<Preferences> {
    preferences ??= Promise.resolve()
      .then(options.initialize)
      .then((value) => preferencesSchema.parse(value))
      .catch((error: unknown) => {
        preferences = undefined;
        throw error;
      });
    return preferences;
  }

  const handleMessage = async (message: unknown, sender: unknown): Promise<MessageResponse> => {
    if (!isTrustedSender(sender, options.extensionId)) {
      return errorResponse('forbidden', 'Emisor no autorizado.');
    }

    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) return errorResponse('invalid-input', 'Mensaje no valido.');
    const request = parsed.data;
    if (request.operation === 'preferences.set') {
      const context = senderSchema.parse(sender);
      if (new URL(context.url).protocol !== 'chrome-extension:') {
        return errorResponse('forbidden', 'Operacion no autorizada.', request.requestId);
      }
    }

    try {
      const state = await loadPreferences();
      if (request.operation === 'preferences.set') {
        const save = options.save;
        if (!save) return errorResponse('unsupported', 'Preferencia no disponible.', request.requestId);
        const next: Preferences = { schemaVersion: 1, panelEnabled: request.payload.panelEnabled };
        const operation = writes.then(async () => {
          await save(next);
          preferences = Promise.resolve(next);
        });
        writes = operation.catch(() => undefined);
        await operation;
        return { version: PROTOCOL_VERSION, requestId: request.requestId, ok: true, data: next };
      }
      return {
        version: PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        data: request.operation === 'preferences.get' ? state : RUNTIME_STATUS,
      };
    } catch {
      return errorResponse('internal', 'No se pudo inicializar el almacenamiento.', request.requestId);
    }
  };

  return Object.assign(handleMessage, { initialize: loadPreferences });
}