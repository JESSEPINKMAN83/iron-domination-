import type { Difficulty, Personality } from '../content/phase6';
import type { CombatMode } from '../content/rules';

export interface MultiplayerRoom {
  code: string;
  mapId?: string;
  seed: number;
  ai: Difficulty;
  aiStyle: Personality;
  combatMode?: CombatMode;
  inputDelay?: number;
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
  ready?: boolean;
  engine?: string;
  pingMs?: number;
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

type RelayMessage =
  | MultiplayerEvent
  | { type: 'session'; requestId?: string; room: MultiplayerRoom; player: MultiplayerPlayer }
  | { type: 'error'; requestId?: string; error: string }
  | { type: 'ping'; nonce: string; sentAt: number };

type PendingRequest = {
  resolve: (session: MultiplayerSession) => void;
  reject: (err: Error) => void;
  timeout: number;
};

export class MultiplayerClient {
  private socket?: WebSocket;
  private pending = new Map<string, PendingRequest>();
  private onEvent?: (event: MultiplayerEvent) => void;
  private onError?: () => void;
  private onOpen?: () => void;
  private lastSession?: MultiplayerSession;

  constructor(readonly baseUrl: string) {}

  async host(settings: { mapId?: string; seed: number; ai: Difficulty; aiStyle: Personality; combatMode?: CombatMode; armyCount?: number; armySides?: number[]; name?: string; playerId?: string }): Promise<MultiplayerSession> {
    await this.ensureSocket();
    return this.request({
      type: 'host',
      settings: { ...settings, armyCount: 2 },
      name: settings.name,
      playerId: settings.playerId,
      engine: browserEngine(),
    });
  }

  async join(code: string, name?: string, playerId?: string): Promise<MultiplayerSession> {
    await this.ensureSocket();
    return this.request({ type: 'join', code: normalizeRoomCode(code), name, playerId, engine: browserEngine() });
  }

  async sendCommand(roomCode: string, playerId: string, tick: number, command: unknown): Promise<void> {
    this.send({ type: 'command', roomCode: normalizeRoomCode(roomCode), playerId, tick, command });
  }

  updateSettings(roomCode: string, playerId: string, settings: { mapId?: string; seed: number; ai: Difficulty; aiStyle: Personality; combatMode?: CombatMode; armySides?: number[] }): void {
    this.send({ type: 'settings', roomCode: normalizeRoomCode(roomCode), playerId, settings });
  }

  setReady(roomCode: string, playerId: string, ready: boolean): void {
    this.send({ type: 'ready', roomCode: normalizeRoomCode(roomCode), playerId, ready });
  }

  connect(_roomCode: string, _playerId: string, onEvent: (event: MultiplayerEvent) => void, onError: () => void, onOpen?: () => void): void {
    this.onEvent = onEvent;
    this.onError = onError;
    this.onOpen = onOpen;
    if (this.socket?.readyState === WebSocket.OPEN) this.onOpen?.();
    else void this.ensureSocket().then(() => this.onOpen?.()).catch(() => this.onError?.());
  }

  disconnect(): void {
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(new Error('connection-closed'));
    }
    this.pending.clear();
    this.socket?.close();
    this.socket = undefined;
  }

  private async ensureSocket(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const open = (): void => {
          cleanup();
          resolve();
        };
        const error = (): void => {
          cleanup();
          reject(new Error('server-unreachable'));
        };
        const cleanup = (): void => {
          this.socket?.removeEventListener('open', open);
          this.socket?.removeEventListener('error', error);
        };
        this.socket?.addEventListener('open', open, { once: true });
        this.socket?.addEventListener('error', error, { once: true });
      });
      return;
    }
    this.socket = new WebSocket(webSocketUrl(this.baseUrl));
    this.socket.onmessage = (event) => this.handleMessage(event.data);
    this.socket.onclose = () => {
      this.onError?.();
      this.rejectPending('connection-closed');
    };
    this.socket.onerror = () => {
      this.onError?.();
      this.rejectPending('server-unreachable');
    };
    await new Promise<void>((resolve, reject) => {
      this.socket!.addEventListener('open', () => resolve(), { once: true });
      this.socket!.addEventListener('error', () => reject(new Error('server-unreachable')), { once: true });
    });
  }

  private request(payload: Record<string, unknown>): Promise<MultiplayerSession> {
    const requestId = crypto.randomUUID();
    const message = { ...payload, requestId };
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('request-timeout'));
      }, 10000);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.send(message);
    });
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('server-unreachable');
    this.socket.send(JSON.stringify(payload));
  }

  private handleMessage(raw: unknown): void {
    let message: RelayMessage;
    try {
      message = JSON.parse(String(raw)) as RelayMessage;
    } catch {
      return;
    }
    if (message.type === 'ping') {
      this.send({ type: 'pong', nonce: message.nonce });
      return;
    }
    if (message.type === 'session') {
      const pending = message.requestId ? this.pending.get(message.requestId) : undefined;
      const session = { room: message.room, player: message.player };
      this.lastSession = session;
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pending.delete(message.requestId!);
        pending.resolve(session);
      }
      return;
    }
    if (message.type === 'error') {
      const pending = message.requestId ? this.pending.get(message.requestId) : undefined;
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pending.delete(message.requestId!);
        pending.reject(new Error(message.error));
      } else {
        this.onError?.();
      }
      return;
    }
    this.onEvent?.(message);
  }

  private rejectPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function normalizedBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'http://127.0.0.1:8787';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^wss?:\/\//i.test(trimmed)) return trimmed.replace(/^ws/i, 'http');
  return `http://${trimmed}`;
}

function webSocketUrl(value: string): string {
  const url = new URL(normalizedBaseUrl(value));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  return url.toString();
}

function browserEngine(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('firefox')) return 'gecko';
  if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium')) return 'webkit';
  if (ua.includes('chrome') || ua.includes('chromium') || ua.includes('edg/')) return 'chromium';
  return 'unknown';
}
