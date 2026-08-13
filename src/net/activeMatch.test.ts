import { describe, expect, it } from 'vitest';
import {
  ACTIVE_MULTIPLAYER_MATCH_STORAGE_KEY,
  clearActiveMultiplayerMatch,
  readActiveMultiplayerMatch,
  rememberActiveMultiplayerMatch,
} from './activeMatch';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('active multiplayer match recovery', () => {
  it('remembers enough information to reclaim a slot after refresh', () => {
    const storage = new MemoryStorage();
    rememberActiveMultiplayerMatch(storage, {
      server: 'https://relay.example.com/',
      roomCode: 'ab-cd12',
      playerId: '11111111-1111-4111-8111-111111111111',
    });

    expect(readActiveMultiplayerMatch(storage)).toEqual({
      version: 1,
      server: 'https://relay.example.com/',
      roomCode: 'ABCD12',
      playerId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('ignores malformed recovery data', () => {
    const storage = new MemoryStorage();
    storage.setItem(ACTIVE_MULTIPLAYER_MATCH_STORAGE_KEY, JSON.stringify({
      version: 1,
      server: 'https://relay.example.com',
      roomCode: '',
      playerId: 'not-a-player-id',
    }));

    expect(readActiveMultiplayerMatch(storage)).toBeUndefined();
  });

  it('clears the recovery marker after an intentional match end', () => {
    const storage = new MemoryStorage();
    rememberActiveMultiplayerMatch(storage, {
      server: 'https://relay.example.com',
      roomCode: 'ABCD12',
      playerId: '11111111-1111-4111-8111-111111111111',
    });

    clearActiveMultiplayerMatch(storage);
    expect(readActiveMultiplayerMatch(storage)).toBeUndefined();
  });
});
