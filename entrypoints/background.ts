import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createHistoryMessageHandler, createMessageHandler, errorResponse, panelChangedSchema } from '../src/messaging/protocol';
import { createHistoryStore } from '../src/background/store';
import { DEFAULT_PREFERENCES, preferencesSchema } from '../src/shared/contracts';

export default defineBackground(() => {
	const handleHistory = createHistoryMessageHandler({ extensionId: browser.runtime.id, history: createHistoryStore(),
		open: async (key) => { await browser.tabs.create({ url: browser.runtime.getURL('/options.html') + (key ? `#${encodeURIComponent(key)}` : '') }); },
	});
	const handleMessage = createMessageHandler({
		extensionId: browser.runtime.id,
		initialize: async () => {
			await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
			const stored = await browser.storage.local.get('preferences');
			const parsed = preferencesSchema.safeParse(stored.preferences);
			return parsed.success ? parsed.data : { ...DEFAULT_PREFERENCES };
		},
		save: async (preferences) => {
			await browser.storage.local.set({ preferences });
			void browser.tabs.query({ url: ['https://*.mercadolibre.com.ar/*'] }).then((tabs) =>
				Promise.allSettled(tabs.filter((tab) => tab.id !== undefined).map((tab) =>
					browser.tabs.sendMessage(tab.id!, { type: 'preferences.changed', preferences }))),
			).catch(() => undefined);
		},
	});

	browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (sender.id === browser.runtime.id && panelChangedSchema.safeParse(message).success) return false;
		const handler = message && typeof message === 'object' && 'operation' in message
			&& typeof message.operation === 'string' && message.operation.startsWith('history.') ? handleHistory : handleMessage;
		void handler(message, sender).then(sendResponse, () => {
			sendResponse(errorResponse('internal', 'No se pudo procesar el mensaje.'));
		});
		return true;
	});

	void handleMessage.initialize().catch(() => undefined);
});