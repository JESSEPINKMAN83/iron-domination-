import type { Difficulty, Personality } from '../content/phase6';
import type { CombatMode } from '../content/rules';

export interface MultiplayerRoom {
  code: string;
  mapId?: string;
  mapSize?: string;
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
  engine?: string;
  pingMs?: number;
  color?: MultiplayerColor;
  ready?: boolean;
  rematchReady?: boolean;
}

export type MultiplayerColor = 'jade' | 'crimson' | 'azure' | 'amber';

export type TacticalPingKind = 'attack' | 'help' | 'defend' | 'good-game';

export interface TacticalPing {
  type: 'tactical-ping';
  playerId: string;
  playerIndex: number;
  name: string;
  kind: TacticalPingKind;
  x: number;
  z: number;
}

export type MultiplayerEvent =
  | { type: 'room-state'; room: MultiplayerRoom }
  | { type: 'match-start'; room: MultiplayerRoom; rematch?: boolean }
  | { type: 'command'; playerId: string; playerIndex: number; tick: number; command: unknown }
  | TacticalPing
  | { type: 'heartbeat'; now: number }
  | { type: 'player-forfeit'; playerId: string; playerIndex: number; name: string }
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
  private serverClosedRoom = false;
  private shouldReconnect = false;
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: number;
  private reconnectStartedAt?: number;

  constructor(readonly baseUrl: string) {}

  async host(settings: { mapId?: string; mapSize?: string; seed: number; ai: Difficulty; aiStyle: Personality; combatMode?: CombatMode; armyCount?: number; armySides?: number[]; name?: string; playerId?: string }): Promise<MultiplayerSession> {
    await this.ensureSocket();
    return this.request({
      type: 'host',
      settings,
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

  sendTacticalPing(roomCode: string, playerId: string, kind: TacticalPingKind, x: number, z: number): void {
    this.send({ type: 'tactical-ping', roomCode: normalizeRoomCode(roomCode), playerId, kind, x, z });
  }

  updateSettings(roomCode: string, playerId: string, settings: { mapId?: string; mapSize?: string; seed: number; ai: Difficulty; aiStyle: Personality; combatMode?: CombatMode; armySides?: number[] }): void {
    this.send({ type: 'settings', roomCode: normalizeRoomCode(roomCode), playerId, settings });
  }

  startMatch(roomCode: string, playerId: string): void {
    this.send({ type: 'start-match', roomCode: normalizeRoomCode(roomCode), playerId });
  }

  setReady(roomCode: string, playerId: string, ready: boolean): void {
    this.send({ type: 'set-ready', roomCode: normalizeRoomCode(roomCode), playerId, ready });
  }

  updatePlayerProfile(roomCode: string, playerId: string, profile: { name?: string; color?: MultiplayerColor; side?: number }): void {
    this.send({ type: 'player-profile', roomCode: normalizeRoomCode(roomCode), playerId, profile });
  }

  requestRematch(roomCode: string, playerId: string): void {
    this.send({ type: 'request-rematch', roomCode: normalizeRoomCode(roomCode), playerId });
  }

  forfeit(roomCode: string, playerId: string): void {
    this.send({ type: 'forfeit', roomCode: normalizeRoomCode(roomCode), playerId });
  }

  connect(_roomCode: string, _playerId: string, onEvent: (event: MultiplayerEvent) => void, onError: () => void, onOpen?: () => void): void {
    this.onEvent = onEvent;
    this.onError = onError;
    this.onOpen = onOpen;
    this.shouldReconnect = true;
    if (this.socket?.readyState === WebSocket.OPEN) this.onOpen?.();
    else void this.ensureSocket().then(() => this.onOpen?.()).catch(() => this.onError?.());
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.reconnecting = false;
    this.reconnectStartedAt = undefined;
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
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
      await this.waitForSocketOpen(this.socket);
      return;
    }
    const socket = new WebSocket(webSocketUrl(this.baseUrl));
    this.socket = socket;
    this.serverClosedRoom = false;
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onclose = () => {
      if (this.socket === socket) this.socket = undefined;
      if (!this.serverClosedRoom) this.onError?.();
      this.rejectPending('connection-closed');
      this.reconnectStartedAt ??= Date.now();
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      this.onError?.();
      this.rejectPending('server-unreachable');
    };
    await this.waitForSocketOpen(socket);
  }

  private waitForSocketOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        socket.close();
        reject(new Error('server-unreachable'));
      }, 8000);
      const open = (): void => {
        cleanup();
        resolve();
      };
      const error = (): void => {
        cleanup();
        reject(new Error('server-unreachable'));
      };
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        socket.removeEventListener('open', open);
        socket.removeEventListener('error', error);
      };
      socket.addEventListener('open', open, { once: true });
      socket.addEventListener('error', error, { once: true });
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.serverClosedRoom || !this.lastSession || this.reconnectTimer !== undefined) return;
    const delay = Math.min(5000, 500 * 2 ** Math.min(this.reconnectAttempt, 4));
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnectSession();
    }, delay);
  }

  private async reconnectSession(): Promise<void> {
    if (this.reconnecting || !this.shouldReconnect || !this.lastSession) return;
    this.reconnecting = true;
    const previous = this.lastSession;
    try {
      await this.ensureSocket();
      const session = await this.request({
        type: 'join',
        code: previous.room.code,
        name: previous.player.name,
        playerId: previous.player.id,
        engine: browserEngine(),
      });
      this.lastSession = session;
      this.reconnectAttempt = 0;
      this.reconnectStartedAt = undefined;
      this.onOpen?.();
    } catch (err) {
      const reason = String((err as Error).message ?? err);
      if (reason === 'room-not-found' && previous.player.index === 1) {
        try {
          const session = await this.request({
            type: 'resume-room',
            room: previous.room,
            player: previous.player,
            engine: browserEngine(),
          });
          this.lastSession = session;
          this.reconnectAttempt = 0;
          this.reconnectStartedAt = undefined;
          this.onOpen?.();
          return;
        } catch {
          this.scheduleReconnect();
        }
      } else if (reason === 'room-full' || Date.now() - (this.reconnectStartedAt ?? Date.now()) >= 180_000) {
        this.serverClosedRoom = true;
        this.shouldReconnect = false;
        this.onEvent?.({ type: 'room-closed', reason: 'reconnect-expired' });
      } else {
        this.scheduleReconnect();
      }
    } finally {
      this.reconnecting = false;
    }
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
    if (message.type === 'room-closed') {
      this.serverClosedRoom = true;
      this.shouldReconnect = false;
      if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if ((message.type === 'room-state' || message.type === 'match-start') && this.lastSession) {
      this.lastSession = { ...this.lastSession, room: message.room };
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
