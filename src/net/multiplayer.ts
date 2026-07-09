import type { Difficulty, Personality } from '../content/phase6';
import type { CombatMode } from '../content/rules';

export interface MultiplayerRoom {
  code: string;
  mapId?: string;
  seed: number;
  ai: Difficulty;
  aiStyle: Personality;
  combatMode?: CombatMode;
  armyCount: number;
  armySides: number[];
  status: 'waiting' | 'starting' | 'in-game';
  startsAt?: number;
  players: MultiplayerPlayer[];
}

export interface MultiplayerPlayer {
  id: string;
  index: number;
  name: string;
  connected: boolean;
}

export type MultiplayerEvent =
  | { type: 'room-state'; room: MultiplayerRoom }
  | { type: 'match-start'; room: MultiplayerRoom }
  | { type: 'command'; playerId: string; playerIndex: number; tick: number; command: unknown }
  | { type: 'heartbeat'; now: number }
  | { type: 'room-closed'; reason: string };

export interface MultiplayerSession {
  room: MultiplayerRoom;
  player: MultiplayerPlayer;
}

export class MultiplayerClient {
  private events?: EventSource;

  constructor(readonly baseUrl: string) {}

  async host(settings: { mapId?: string; seed: number; ai: Difficulty; aiStyle: Personality; combatMode?: CombatMode; armyCount?: number; armySides?: number[]; name?: string; playerId?: string }): Promise<MultiplayerSession> {
    return this.post('/rooms', settings);
  }

  async join(code: string, name?: string, playerId?: string): Promise<MultiplayerSession> {
    return this.post(`/rooms/${normalizeRoomCode(code)}/join`, { name, playerId });
  }

  async sendCommand(roomCode: string, playerId: string, tick: number, command: unknown): Promise<void> {
    await this.postOk(`/rooms/${normalizeRoomCode(roomCode)}/command`, { playerId, tick, command });
  }

  connect(roomCode: string, playerId: string, onEvent: (event: MultiplayerEvent) => void, onError: () => void, onOpen?: () => void): void {
    this.disconnect();
    const url = new URL(`/rooms/${normalizeRoomCode(roomCode)}/events`, normalizedBaseUrl(this.baseUrl));
    url.searchParams.set('playerId', playerId);
    this.events = new EventSource(url.toString());
    this.events.onopen = () => onOpen?.();
    this.events.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data) as MultiplayerEvent);
      } catch {
        // Ignore malformed relay payloads; the next room-state heartbeat will recover UI.
      }
    };
    this.events.onerror = () => onError();
  }

  disconnect(): void {
    this.events?.close();
    this.events = undefined;
  }

  private async post(path: string, body: unknown): Promise<MultiplayerSession> {
    const response = await fetch(new URL(path, normalizedBaseUrl(this.baseUrl)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { ok: boolean; room?: MultiplayerRoom; player?: MultiplayerPlayer; error?: string };
    if (!response.ok || !payload.ok || !payload.room || !payload.player) throw new Error(payload.error ?? `multiplayer-${response.status}`);
    return { room: payload.room, player: payload.player };
  }

  private async postOk(path: string, body: unknown): Promise<void> {
    const response = await fetch(new URL(path, normalizedBaseUrl(this.baseUrl)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? `multiplayer-${response.status}`);
  }
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function normalizedBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'http://127.0.0.1:8787';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
