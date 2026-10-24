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
      { id: 'host', index: 1, armyId: 1, role: 'commander', name: 'Host', connected: true },
    ]), 'host')).toBe(true);
  });

  it('launches multiplayer when a guest is connected', () => {
    expect(shouldLaunchLocalSkirmish(room([
      { id: 'host', index: 1, armyId: 1, role: 'commander', name: 'Host', connected: true },
      { id: 'guest', index: 2, armyId: 2, role: 'commander', name: 'Guest', connected: true },
    ]), 'host')).toBe(false);
  });

  it('returns to a local skirmish when the former guest is disconnected', () => {
    expect(shouldLaunchLocalSkirmish(room([
      { id: 'host', index: 1, armyId: 1, role: 'commander', name: 'Host', connected: true },
      { id: 'guest', index: 2, armyId: 2, role: 'commander', name: 'Guest', connected: false },
    ]), 'host')).toBe(true);
  });
});

describe('cancelled room recovery', () => {
  it('does not keep trying a saved room after the user cancels', async () => {
    const controller = new AbortController(); controller.abort();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(waitForMultiplayerServer('https://relay.example.com', {signal:controller.signal})).rejects.toThrow('connection-cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it('aborts an in-flight health check when a rejoin attempt is cancelled', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn((_url: string, options: {signal:AbortSignal}) => new Promise((_resolve,reject) => {
    options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  })));
  const pending = waitForMultiplayerServer('https://relay.example.com',{signal:controller.signal});
  controller.abort();
  await expect(pending).rejects.toThrow('connection-cancelled');
});
