import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createMessageHandler, errorResponse } from '../src/messaging/protocol';
import { DEFAULT_PREFERENCES, preferencesSchema } from '../src/shared/contracts';

export default defineBackground(() => {
	const handleMessage = createMessageHandler({
		extensionId: browser.runtime.id,
		initialize: async () => {
			await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
			const stored = await browser.storage.local.get('preferences');
			const parsed = preferencesSchema.safeParse(stored.preferences);
			return parsed.success ? parsed.data : { ...DEFAULT_PREFERENCES };
		},
	});

	browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		void handleMessage(message, sender).then(sendResponse, () => {
			sendResponse(errorResponse('internal', 'No se pudo procesar el mensaje.'));
		});
		return true;
	});

	void handleMessage.initialize().catch(() => undefined);
});