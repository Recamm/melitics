import { browser } from 'wxt/browser';
import { panelRequestSchema, panelResponseSchema, requestSchema, responseSchema, type PanelOperation } from './protocol';
import { PROTOCOL_VERSION } from '../shared/contracts';

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