import { browser } from 'wxt/browser';
import { panelRequestSchema, panelResponseSchema, requestSchema, responseSchema, type PanelOperation } from './protocol';
import { PROTOCOL_VERSION } from '../shared/contracts';
import { historyRequestSchema, historyResponseSchema, type HistoryRequest, type historyResponseDataSchema } from './protocol';
import type { z } from 'zod';

type HistoryDataOf<Kind extends z.infer<typeof historyResponseDataSchema>['kind']> = Extract<z.infer<typeof historyResponseDataSchema>, { kind: Kind }>;
export async function historyRequest<Kind extends z.infer<typeof historyResponseDataSchema>['kind']>(
  operation: HistoryRequest['operation'], payload: HistoryRequest['payload'], kind: Kind,
): Promise<HistoryDataOf<Kind>> {
  const request = historyRequestSchema.parse({ version: PROTOCOL_VERSION, requestId: crypto.randomUUID(), operation, payload });
  const response = historyResponseSchema.parse(await browser.runtime.sendMessage(request));
  if (!response.ok) throw new Error(response.error.message);
  if (response.requestId !== request.requestId || response.data.kind !== kind) throw new Error('Respuesta de historial no valida.');
  return response.data as HistoryDataOf<Kind>;
}

export async function workerRequest(operation: 'preferences.get' | 'preferences.set', payload: Record<string, unknown> = {}) {
  const request = requestSchema.parse({ version: PROTOCOL_VERSION, requestId: crypto.randomUUID(), operation, payload });
  const response = responseSchema.parse(await browser.runtime.sendMessage(request));
  if (!response.ok || response.requestId !== request.requestId) throw new Error('Worker request failed');
  return response.data;
}

export async function panelRequest(tabId: number, operation: PanelOperation) {
  const request = panelRequestSchema.parse({ version: PROTOCOL_VERSION, requestId: crypto.randomUUID(), operation, payload: {} });
  const response = panelResponseSchema.parse(await browser.tabs.sendMessage(tabId, request));
  if (!response.ok || response.requestId !== request.requestId) throw new Error('Panel request failed');
  return response.data;
}