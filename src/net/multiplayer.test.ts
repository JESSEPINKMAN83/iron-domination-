import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldLaunchLocalSkirmish, waitForMultiplayerServer, type MultiplayerRoom } from './multiplayer';

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

describe('host match mode selection', () => {
  const room = (players: MultiplayerRoom['players']): MultiplayerRoom => ({
    code: 'LOCAL1',
    seed: 42,
    ai: 'normal',
    aiStyle: 'balanced',
    armyCount: 2,
    armySides: [1, 2],
    status: 'waiting',
    players,
  });

  it('launches a local skirmish when only the host is connected', () => {
    expect(shouldLaunchLocalSkirmish(room([
      { id: 'host', index: 1, name: 'Host', connected: true },
    ]), 'host')).toBe(true);
  });

  it('launches multiplayer when a guest is connected', () => {
    expect(shouldLaunchLocalSkirmish(room([
      { id: 'host', index: 1, name: 'Host', connected: true },
      { id: 'guest', index: 2, name: 'Guest', connected: true },
    ]), 'host')).toBe(false);
  });

  it('returns to a local skirmish when the former guest is disconnected', () => {
    expect(shouldLaunchLocalSkirmish(room([
      { id: 'host', index: 1, name: 'Host', connected: true },
      { id: 'guest', index: 2, name: 'Guest', connected: false },
    ]), 'host')).toBe(true);
  });
});
