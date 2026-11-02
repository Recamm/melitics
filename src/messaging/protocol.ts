import { z } from 'zod';
import {
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

export function errorResponse(
  code: ErrorCode,
  message: string,
  requestId: string | null = null,
): MessageResponse {
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