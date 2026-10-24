import { normalizeRoomCode, normalizedBaseUrl, type MultiplayerRoom } from './multiplayer';

export const ACTIVE_MULTIPLAYER_MATCH_STORAGE_KEY = 'iron-dominion.multiplayer.active-match.v1';

export interface ActiveMultiplayerMatch {
  version: 1;
  server: string;
  roomCode: string;
  playerId: string;
  room?: MultiplayerRoom;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function rememberActiveMultiplayerMatch(
  storage: StorageLike,
  value: Omit<ActiveMultiplayerMatch, 'version'>,
): ActiveMultiplayerMatch {
  const state: ActiveMultiplayerMatch = {
    version: 1,
    server: normalizedBaseUrl(value.server),
    roomCode: normalizeRoomCode(value.roomCode),
    playerId: value.playerId,
    ...(value.room ? { room: value.room } : {}),
  };
  try {
    storage.setItem(ACTIVE_MULTIPLAYER_MATCH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The current match still works when private browsing blocks storage.
  }
  return state;
}

export function readActiveMultiplayerMatch(storage: StorageLike): ActiveMultiplayerMatch | undefined {
  try {
    const raw = storage.getItem(ACTIVE_MULTIPLAYER_MATCH_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ActiveMultiplayerMatch>;
    const roomCode = normalizeRoomCode(parsed.roomCode ?? '');
    const playerId = typeof parsed.playerId === 'string' ? parsed.playerId : '';
    if (parsed.version !== 1 || !roomCode || !/^[0-9a-f-]{16,64}$/i.test(playerId)) return undefined;
    return {
      version: 1,
      server: normalizedBaseUrl(typeof parsed.server === 'string' ? parsed.server : ''),
      roomCode,
      playerId,
      ...(parsed.room && typeof parsed.room === 'object' && normalizeRoomCode(parsed.room.code ?? '') === roomCode && Array.isArray(parsed.room.players) ? {room:parsed.room} : {}),
    };
  } catch {
    return undefined;
  }
}

export function clearActiveMultiplayerMatch(storage: StorageLike): void {
  try {
    storage.removeItem(ACTIVE_MULTIPLAYER_MATCH_STORAGE_KEY);
  } catch {
    // Recovery is best-effort when browser storage is unavailable.
  }
}
