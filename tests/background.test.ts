import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import background from '../entrypoints/background';
import { responseSchema, type MessageResponse } from '../src/messaging/protocol';

type MessageListener = (
  message: unknown,
  sender: Browser.runtime.MessageSender,
  respond: (response: MessageResponse) => void,
) => boolean;

const mocks = vi.hoisted(() => ({
  addListener: vi.fn<(listener: MessageListener) => void>(),
  setAccessLevel: vi.fn<() => Promise<void>>(),
  get: vi.fn<() => Promise<Record<string, unknown>>>(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      onMessage: { addListener: mocks.addListener },
    },
    storage: {
      local: { setAccessLevel: mocks.setAccessLevel, get: mocks.get },
    },
  },
}));

const request = {
  version: 1,
  requestId: 'ce155c60-0e5a-4d7f-8295-f9ac878ecb3c',
  operation: 'preferences.get',
  payload: {},
};
const sender = {
  id: 'abcdefghijklmnopabcdefghijklmnop',
  url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
};

function startWorker(): MessageListener {
  background.main();
  const listener = mocks.addListener.mock.lastCall?.[0];
  if (!listener) throw new Error('The worker did not register its listener synchronously');
  return listener;
}

async function sendMessage(listener: MessageListener, message: unknown = request) {
  const respond = vi.fn();
  expect(listener(message, sender, respond)).toBe(true);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
  return responseSchema.parse(respond.mock.calls[0]?.[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setAccessLevel.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue({});
});

describe('background lifecycle', () => {
  it('registers synchronously and initializes storage before receiving messages', async () => {
    startWorker();
    expect(mocks.addListener).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(mocks.setAccessLevel).toHaveBeenCalledOnce());
    expect(mocks.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledWith('preferences'));
  });

  it('keeps the Chrome 120 channel open while access restriction is pending', async () => {
    let releaseAccess!: () => void;
    mocks.setAccessLevel.mockImplementation(() => new Promise<void>((resolve) => {
      releaseAccess = resolve;
    }));
    const listener = startWorker();
    const respond = vi.fn();
    expect(listener(request, sender, respond)).toBe(true);
    await vi.waitFor(() => expect(mocks.setAccessLevel).toHaveBeenCalledOnce());
    expect(mocks.get).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
    releaseAccess();
    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
    expect(responseSchema.parse(respond.mock.calls[0]?.[0])).toMatchObject({
      ok: true,
      data: { schemaVersion: 1, panelEnabled: true },
    });
  });

  it('rehydrates saved preferences when a new worker instance starts', async () => {
    mocks.get.mockResolvedValue({ preferences: { schemaVersion: 1, panelEnabled: false } });
    expect(await sendMessage(startWorker())).toMatchObject({ ok: true, data: { panelEnabled: false } });
    expect(await sendMessage(startWorker())).toMatchObject({ ok: true, data: { panelEnabled: false } });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it.each([
    { schemaVersion: 2, panelEnabled: false },
    { schemaVersion: 1, panelEnabled: true, csrfToken: 'private-value' },
    null,
  ])('falls back safely for incompatible stored preferences: %j', async (preferences) => {
    mocks.get.mockResolvedValue({ preferences });
    const response = await sendMessage(startWorker());
    expect(response).toMatchObject({ ok: true, data: { schemaVersion: 1, panelEnabled: true } });
    expect(JSON.stringify(response)).not.toContain('private-value');
  });

  it('returns a safe error and never reads storage if access restriction fails', async () => {
    mocks.setAccessLevel.mockRejectedValue(new Error('private-error-detail'));
    const response = await sendMessage(startWorker());
    expect(response).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).not.toContain('private-error-detail');
  });
});