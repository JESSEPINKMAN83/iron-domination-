import { describe, expect, it } from 'vitest';
import { lobbyAvatarModel } from './commander';

describe('lobby avatar presentation', () => {
  it('badges a relay-verified player and says so in the tooltip', () => {
    const model = lobbyAvatarModel({ name: 'Iron Fox', seed: 'player-1', verified: true });
    expect(model.badge).toBe(true);
    expect(model.identity.source).toBe('member');
    expect(model.title).toBe('Iron Fox · verified account');
  });

  it('leaves an unverified player unbadged rather than implying an account', () => {
    const model = lobbyAvatarModel({ name: 'Iron Fox', seed: 'player-1' });
    expect(model.badge).toBe(false);
    expect(model.title).toBe('Iron Fox · guest');
  });

  it('never badges an AI, even if a verified flag leaks through', () => {
    const model = lobbyAvatarModel({ name: 'COMPUTER 2', seed: 'ai-2', isAi: true, verified: true });
    expect(model.badge).toBe(false);
    expect(model.identity.initials).toBe('AI');
    expect(model.title).toBe('Computer opponent');
  });

  it('builds initials from the first and last word of a name', () => {
    expect(lobbyAvatarModel({ name: 'Iron Fox', seed: 's' }).identity.initials).toBe('IF');
    expect(lobbyAvatarModel({ name: 'Dani', seed: 's' }).identity.initials).toBe('D');
    expect(lobbyAvatarModel({ name: 'Ada Byron Lovelace', seed: 's' }).identity.initials).toBe('AL');
  });

  it('gives different players different accents', () => {
    const first = lobbyAvatarModel({ name: 'Alpha One', seed: 'player-1' });
    const second = lobbyAvatarModel({ name: 'Bravo Two', seed: 'player-2' });
    expect(first.identity.accent).not.toBe(second.identity.accent);
  });

  it('keeps the same accent for the same identity across renders and devices', () => {
    const first = lobbyAvatarModel({ name: 'Alpha One', seed: 'player-1' });
    const second = lobbyAvatarModel({ name: 'Alpha One', seed: 'player-1' });
    expect(first.identity.accent).toBe(second.identity.accent);
  });

  it('keys the accent on the seed, so a renamed player keeps their colour', () => {
    const before = lobbyAvatarModel({ name: 'Alpha One', seed: 'player-1' });
    const after = lobbyAvatarModel({ name: 'Renamed Commander', seed: 'player-1' });
    expect(after.identity.accent).toBe(before.identity.accent);
  });
});
