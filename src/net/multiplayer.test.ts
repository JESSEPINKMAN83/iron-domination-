import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForMultiplayerServer } from './multiplayer';

afterEach(() => vi.unstubAllGlobals());

describe('multiplayer relay wake-up', () => {
  it('checks the relay health endpoint before opening a room', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await waitForMultiplayerServer('https://relay.example.com/ws', { timeoutMs: 1_000, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example.com/health');
  });

  it('retries while a sleeping relay is starting', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await waitForMultiplayerServer('https://relay.example.com', { timeoutMs: 1_000, retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
