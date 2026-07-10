import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

type RelayMessage = Record<string, any> & { type: string };

const children: ChildProcess[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const child of children.splice(0)) child.kill('SIGTERM');
});

describe('multiplayer relay', () => {
  it('accepts an allowed browser origin when the configured URL has a trailing slash', async () => {
    const port = await availablePort();
    const allowedOrigin = 'https://euphonious-manatee-c00a85.netlify.app';
    const child = spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        ALLOWED_ORIGINS: `${allowedOrigin}/`,
      },
      stdio: 'ignore',
    });
    children.push(child);
    await waitForHealth(port);

    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: allowedOrigin },
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: allowedOrigin });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
  });

  it('starts a match, rejects player spoofing, and preserves a reconnecting slot', async () => {
    const port = await availablePort();
    const child = spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        HEARTBEAT_MS: '50',
        START_COUNTDOWN_MS: '20',
        RECONNECT_GRACE_MS: '300',
      },
      stdio: 'ignore',
    });
    children.push(child);
    await waitForHealth(port);

    const host = await connect(port);
    host.send(JSON.stringify({ type: 'host', requestId: 'host-1', name: 'Host', settings: { seed: 42 } }));
    const hostSession = await nextMessage(host, (message) => message.type === 'session');
    const roomCode = hostSession.room.code as string;
    const hostId = hostSession.player.id as string;

    const guest = await connect(port);
    guest.send(JSON.stringify({ type: 'join', requestId: 'guest-1', code: roomCode, name: 'Guest' }));
    const guestSession = await nextMessage(guest, (message) => message.type === 'session');
    const guestId = guestSession.player.id as string;

    const synchronizedSettings = nextMessage(
      guest,
      (message) => message.type === 'room-state' && message.room.mapId === 'crater-oasis' && message.room.seed === 246810,
    );
    host.send(JSON.stringify({
      type: 'settings',
      roomCode,
      playerId: hostId,
      settings: { mapId: 'crater-oasis', seed: 246810, combatMode: 'manual', armySides: [1, 2, 3, 4] },
    }));
    await synchronizedSettings;

    const guestCannotStart = noMessage(host, (message) => message.type === 'match-start', 80);
    guest.send(JSON.stringify({ type: 'start-match', roomCode, playerId: guestId }));
    await expect(guestCannotStart).resolves.toBe(true);

    host.send(JSON.stringify({ type: 'start-match', roomCode, playerId: hostId }));
    const [hostStart, guestStart] = await Promise.all([
      nextMessage(host, (message) => message.type === 'match-start'),
      nextMessage(guest, (message) => message.type === 'match-start'),
    ]);
    expect(hostStart.room.mapId).toBe('crater-oasis');
    expect(guestStart.room.mapId).toBe('crater-oasis');
    expect(hostStart.room.seed).toBe(246810);
    expect(guestStart.room.seed).toBe(246810);

    const spoofedCommand = noMessage(host, (message) => message.type === 'command', 80);
    guest.send(JSON.stringify({
      type: 'command',
      roomCode,
      playerId: hostId,
      tick: 5,
      command: { type: 'stop', ids: [1] },
    }));
    await expect(spoofedCommand).resolves.toBe(true);

    const validCommand = nextMessage(host, (message) => message.type === 'command');
    guest.send(JSON.stringify({
      type: 'command',
      roomCode,
      playerId: guestId,
      tick: 6,
      command: { type: 'stop', ids: [2] },
    }));
    const command = await validCommand;
    expect(command.playerId).toBe(guestId);
    expect(command.tick).toBe(6);

    const disconnected = nextMessage(host, (message) =>
      message.type === 'room-state' && message.room.players.some((player: any) => player.id === guestId && !player.connected),
    );
    guest.close();
    await disconnected;

    const rejoined = await connect(port);
    const reconnected = nextMessage(host, (message) =>
      message.type === 'room-state' && message.room.players.some((player: any) => player.id === guestId && player.connected),
    );
    rejoined.send(JSON.stringify({ type: 'join', requestId: 'guest-2', code: roomCode, name: 'Guest', playerId: guestId }));
    const rejoinSession = await nextMessage(rejoined, (message) => message.type === 'session');
    expect(rejoinSession.player.id).toBe(guestId);
    expect(rejoinSession.player.index).toBe(2);
    await reconnected;

    const timedOut = nextMessage(host, (message) => message.type === 'room-closed', 1200);
    rejoined.close();
    const closed = await timedOut;
    expect(closed.reason).toBe('disconnect-timeout:2');
  }, 5000);
});

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // The child may still be opening the listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('relay did not start');
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function nextMessage(socket: WebSocket, predicate: (message: RelayMessage) => boolean, timeoutMs = 1000): Promise<RelayMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('message timeout'));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData): void => {
      const message = JSON.parse(String(raw)) as RelayMessage;
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
    };
    socket.on('message', onMessage);
  });
}

function noMessage(socket: WebSocket, predicate: (message: RelayMessage) => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(true);
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData): void => {
      const message = JSON.parse(String(raw)) as RelayMessage;
      if (!predicate(message)) return;
      cleanup();
      resolve(false);
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
    };
    socket.on('message', onMessage);
  });
}
