import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerStatUpdate } from './playerStats';
import * as session from './session';

function signedIn(id = 'member-1', nickname: string | undefined = 'Iron Fox') {
  vi.spyOn(session, 'cachedMemberProfile').mockReturnValue({ id, nickname, emailVerified: true } as never);
}

const MULTIPLAYER_WIN = { multiplayer: true, status: 'victory', elapsedSeconds: 630 } as const;

afterEach(() => vi.restoreAllMocks());

describe('player stat updates', () => {
  it('records a finished multiplayer match for a signed-in member', () => {
    signedIn();
    expect(playerStatUpdate(MULTIPLAYER_WIN)).toEqual({
      memberId: 'member-1',
      nickname: 'Iron Fox',
      result: 'victory',
      playMinutes: 10.5,
    });
  });

  it('never records single player, so solo players stay anonymous', () => {
    signedIn();
    expect(playerStatUpdate({ ...MULTIPLAYER_WIN, multiplayer: false })).toBeUndefined();
  });

  it('ignores a match that never finished', () => {
    signedIn();
    expect(playerStatUpdate({ ...MULTIPLAYER_WIN, status: 'ongoing' })).toBeUndefined();
  });

  it('records nothing for a guest, even in multiplayer', () => {
    vi.spyOn(session, 'cachedMemberProfile').mockReturnValue(undefined);
    expect(playerStatUpdate(MULTIPLAYER_WIN)).toBeUndefined();
  });

  it('carries a clamped ace share only when the match reported one', () => {
    signedIn();
    expect(playerStatUpdate({ ...MULTIPLAYER_WIN, aceShare: 0.42 })?.aceShare).toBe(0.42);
    expect(playerStatUpdate({ ...MULTIPLAYER_WIN, aceShare: 4 })?.aceShare).toBe(1);
    expect(playerStatUpdate({ ...MULTIPLAYER_WIN, aceShare: Number.NaN })).not.toHaveProperty('aceShare');
    expect(playerStatUpdate(MULTIPLAYER_WIN)).not.toHaveProperty('aceShare');
  });

  it('rounds play minutes to one decimal and never goes negative', () => {
    signedIn();
    expect(playerStatUpdate({ ...MULTIPLAYER_WIN, elapsedSeconds: 95 })?.playMinutes).toBe(1.6);
    expect(playerStatUpdate({ ...MULTIPLAYER_WIN, elapsedSeconds: -50 })?.playMinutes).toBe(0);
  });

  it('sends no nickname rather than a placeholder when the member has none', () => {
    vi.spyOn(session, 'cachedMemberProfile').mockReturnValue({ id: 'member-2', emailVerified: true } as never);
    const update = playerStatUpdate(MULTIPLAYER_WIN);
    expect(update?.memberId).toBe('member-2');
    expect(update?.nickname).toBeUndefined();
  });
});
