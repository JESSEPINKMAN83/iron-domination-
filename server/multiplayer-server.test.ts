import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

type RelayMessage = Record<string, any> & { type: string };

const RELAY_SECRET = 'relay-test-secret';
const ticketFor = (memberId: string) => createHmac('sha256', RELAY_SECRET).update(memberId).digest('base64url');

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

  it('always reports verifiedMember, so a relay deploy is observable without an account', async () => {
    const port = await availablePort();
    children.push(spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), MEMBER_AUTH: 'log' },
      stdio: 'ignore',
    }));
    await waitForHealth(port);

    const socket = await connect(port);
    socket.send(JSON.stringify({ type: 'host', requestId: 'flag-1', name: 'Guest', settings: { seed: 3 } }));
    const session = await nextMessage(socket, (message) => message.type === 'session');

    // An omitted key would be indistinguishable from an older relay build.
    expect(session.player).toHaveProperty('verifiedMember');
    expect(session.player.verifiedMember).toBe(false);
  });

  it('admits an unauthenticated host in log mode but refuses one in enforce mode', async () => {
    const logPort = await availablePort();
    children.push(spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(logPort), MEMBER_AUTH: 'log' },
      stdio: 'ignore',
    }));
    await waitForHealth(logPort);

    const observed = await connect(logPort);
    observed.send(JSON.stringify({ type: 'host', requestId: 'log-1', name: 'Host', settings: { seed: 7 } }));
    const session = await nextMessage(observed, (message) => message.type === 'session' || message.type === 'error');
    expect(session.type).toBe('session');

    const enforcePort = await availablePort();
    children.push(spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(enforcePort),
        MEMBER_AUTH: 'enforce',
        IRON_DOMINION_INGEST_SECRET: RELAY_SECRET,
      },
      stdio: 'ignore',
    }));
    await waitForHealth(enforcePort);

    const blocked = await connect(enforcePort);
    blocked.send(JSON.stringify({ type: 'host', requestId: 'enforce-1', name: 'Host', settings: { seed: 7 } }));
    const refusal = await nextMessage(blocked, (message) => message.type === 'session' || message.type === 'error');
    expect(refusal.type).toBe('error');
    expect(refusal.error).toBe('member-required');

    const blockedJoin = await connect(enforcePort);
    blockedJoin.send(JSON.stringify({ type: 'join', requestId: 'enforce-2', code: 'ABCD', name: 'Guest' }));
    const joinRefusal = await nextMessage(blockedJoin, (message) => message.type === 'session' || message.type === 'error');
    expect(joinRefusal.error).toBe('member-required');

    const admitted = await connect(enforcePort);
    admitted.send(JSON.stringify({
      type: 'host',
      requestId: 'enforce-3',
      name: 'Host',
      settings: { seed: 7 },
      memberId: 'member-1',
      memberTicket: ticketFor('member-1'),
    }));
    const session2 = await nextMessage(admitted, (message) => message.type === 'session' || message.type === 'error');
    expect(session2.type).toBe('session');
    expect(session2.player.verifiedMember).toBe(true);
  });

  it('admits everyone when enforce is on but no secret is configured, so a missing env var cannot lock the game', async () => {
    const port = await availablePort();
    children.push(spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), MEMBER_AUTH: 'enforce', IRON_DOMINION_INGEST_SECRET: '' },
      stdio: 'ignore',
    }));
    await waitForHealth(port);

    const socket = await connect(port);
    socket.send(JSON.stringify({ type: 'host', requestId: 'no-secret-1', name: 'Guest', settings: { seed: 9 } }));
    const session = await nextMessage(socket, (message) => message.type === 'session' || message.type === 'error');
    expect(session.type).toBe('session');
    expect(session.player.verifiedMember).toBe(false);
  });

  it('refuses a ticket that was signed for a different member', async () => {
    const port = await availablePort();
    children.push(spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), MEMBER_AUTH: 'enforce', IRON_DOMINION_INGEST_SECRET: RELAY_SECRET },
      stdio: 'ignore',
    }));
    await waitForHealth(port);

    const socket = await connect(port);
    socket.send(JSON.stringify({
      type: 'host',
      requestId: 'replay-1',
      name: 'Impostor',
      settings: { seed: 11 },
      memberId: 'member-2',
      memberTicket: ticketFor('member-1'),
    }));
    const refusal = await nextMessage(socket, (message) => message.type === 'session' || message.type === 'error');
    expect(refusal.error).toBe('member-required');
  });

  it('lets a verified member reclaim their reserved player slot in enforce mode', async () => {
    const port = await availablePort();
    children.push(spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        MEMBER_AUTH: 'enforce',
        IRON_DOMINION_INGEST_SECRET: RELAY_SECRET,
        RECONNECT_GRACE_MS: '1000',
      },
      stdio: 'ignore',
    }));
    await waitForHealth(port);

    const original = await connect(port);
    original.send(JSON.stringify({
      type: 'host',
      requestId: 'member-host',
      name: 'Member Host',
      settings: { seed: 17 },
      memberId: 'member-1',
      memberTicket: ticketFor('member-1'),
    }));
    const hosted = await nextMessage(original, (message) => message.type === 'session');
    original.close();

    const intruder = await connect(port);
    intruder.send(JSON.stringify({
      type: 'join',
      requestId: 'member-intruder',
      code: hosted.room.code,
      playerId: hosted.player.id,
      memberId: 'member-2',
      memberTicket: ticketFor('member-2'),
    }));
    const rejected = await nextMessage(intruder, (message) => message.type === 'session' || message.type === 'error');
    expect(rejected.error).toBe('member-mismatch');
    intruder.close();

    const replacement = await connect(port);
    replacement.send(JSON.stringify({
      type: 'join',
      requestId: 'member-rejoin',
      code: hosted.room.code,
      playerId: hosted.player.id,
      memberId: 'member-1',
      memberTicket: ticketFor('member-1'),
    }));
    const rejoined = await nextMessage(replacement, (message) => message.type === 'session' || message.type === 'error');

    expect(rejoined.type).toBe('session');
    expect(rejoined.player.id).toBe(hosted.player.id);
    expect(rejoined.player.verifiedMember).toBe(true);
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
      (message) => message.type === 'room-state' && message.room.mapId === 'crater-oasis' && message.room.mapSize === 'large' && message.room.seed === 246810 && message.room.oreAmount === 175 && message.room.terrainRelief === 150 && message.room.armyCount === 4,
    );
    host.send(JSON.stringify({
      type: 'settings',
      roomCode,
      playerId: hostId,
      settings: { mapId: 'crater-oasis', mapSize: 'large', seed: 246810, oreAmount: 175, terrainRelief: 150, combatMode: 'manual', armyCount: 4, armySides: [1, 1, 3, 4], spawnSlots: [2, 1, 3, 4] },
    }));
    const synchronizedRoom = await synchronizedSettings;
    expect(synchronizedRoom.room.spawnSlots).toEqual([2, 1, 3, 4]);
    expect(synchronizedRoom.room.seed).toBe(246810);
    expect(synchronizedRoom.room.oreAmount).toBe(175);
    expect(synchronizedRoom.room.terrainRelief).toBe(150);
    expect(synchronizedRoom.room.combatMode).toBe('manual');

    const resizedSettings = nextMessage(
      guest,
      (message) => message.type === 'room-state' && message.room.armyCount === 2 && message.room.seed === 246810,
    );
    host.send(JSON.stringify({
      type: 'settings', roomCode, playerId: hostId,
      settings: { controllerCount: 3, controllerTeams: [1, 1, 2] },
    }));
    await resizedSettings;

    const profileUpdated = nextMessage(
      host,
      (message) => message.type === 'room-state' && message.room.players.some((player: any) => player.id === guestId && player.name === 'Wingmate' && player.role === 'field-officer'),
    );
    guest.send(JSON.stringify({ type: 'player-profile', roomCode, playerId: guestId, profile: { name: 'Wingmate', color: 'azure', side: 1 } }));
    await profileUpdated;

    const bothReady = nextMessage(
      host,
      (message) => message.type === 'room-state' && message.room.players.length === 2 && message.room.players.every((player: any) => player.ready),
    );
    host.send(JSON.stringify({ type: 'set-ready', roomCode, playerId: hostId, ready: true }));
    guest.send(JSON.stringify({ type: 'set-ready', roomCode, playerId: guestId, ready: true }));
    await bothReady;

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
    expect(hostStart.room.mapSize).toBe('large');
    expect(guestStart.room.mapSize).toBe('large');
    expect(hostStart.room.seed).toBe(246810);
    expect(guestStart.room.seed).toBe(246810);
    expect(hostStart.room.oreAmount).toBe(175);
    expect(guestStart.room.oreAmount).toBe(175);
    expect(hostStart.room.terrainRelief).toBe(150);
    expect(guestStart.room.terrainRelief).toBe(150);
    expect(hostStart.room.combatMode).toBe('manual');
    expect(guestStart.room.combatMode).toBe('manual');

    const hostPing = nextMessage(host, (message) => message.type === 'tactical-ping');
    const guestPing = nextMessage(guest, (message) => message.type === 'tactical-ping');
    host.send(JSON.stringify({ type: 'tactical-ping', roomCode, playerId: hostId, kind: 'attack', x: 96.4, z: -44.2 }));
    const [hostPingEvent, guestPingEvent] = await Promise.all([hostPing, guestPing]);
    expect(hostPingEvent.kind).toBe('attack');
    expect(guestPingEvent.kind).toBe('attack');
    expect(guestPingEvent.x).toBe(96.4);
    expect(guestPingEvent.z).toBe(-44.2);

    const hostRematchStart = nextMessage(host, (message) => message.type === 'match-start' && message.rematch === true, 1200);
    const guestRematchStart = nextMessage(guest, (message) => message.type === 'match-start' && message.rematch === true, 1200);
    host.send(JSON.stringify({ type: 'request-rematch', roomCode, playerId: hostId }));
    guest.send(JSON.stringify({ type: 'request-rematch', roomCode, playerId: guestId }));
    await Promise.all([hostRematchStart, guestRematchStart]);

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

    const timedOut = nextMessage(
      host,
      (message) => message.type === 'room-state' && !message.room.players.some((player: any) => player.id === guestId),
      1200,
    );
    rejoined.close();
    const recovered = await timedOut;
    expect(recovered.room.players.some((player: any) => player.id === hostId)).toBe(true);
  }, 5000);

  it('lets a ready host launch alone with open AI slots and blocks late joins', async () => {
    const port = await availablePort();
    const child = spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), HEARTBEAT_MS: '50', START_COUNTDOWN_MS: '20' },
      stdio: 'ignore',
    });
    children.push(child);
    await waitForHealth(port);

    const host = await connect(port);
    host.send(JSON.stringify({ type: 'host', requestId: 'solo-host', name: 'Host', settings: { armyCount: 2, armySides: [1, 1], seed: 9191 } }));
    const session = await nextMessage(host, (message) => message.type === 'session');
    const roomCode = session.room.code as string;
    const hostId = session.player.id as string;

    const started = nextMessage(host, (message) => message.type === 'match-start');
    host.send(JSON.stringify({ type: 'set-ready', roomCode, playerId: hostId, ready: true }));
    host.send(JSON.stringify({ type: 'start-match', roomCode, playerId: hostId }));
    const startEvent = await started;
    expect(startEvent.room.armyCount).toBe(2);
    expect(startEvent.room.armySides.slice(0, 2)).toEqual([1, 2]);
    expect(startEvent.room.players.map((player: any) => player.index)).toEqual([1]);

    const lateGuest = await connect(port);
    lateGuest.send(JSON.stringify({ type: 'join', requestId: 'late-guest', code: roomCode, name: 'Late Guest' }));
    const rejected = await nextMessage(lateGuest, (message) => message.type === 'error' && message.requestId === 'late-guest');
    expect(rejected.error).toBe('match-in-progress');

    const rematch = nextMessage(host, (message) => message.type === 'match-start' && message.rematch === true, 1200);
    host.send(JSON.stringify({ type: 'request-rematch', roomCode, playerId: hostId }));
    await rematch;
  }, 5000);

  it('starts a four-player 2v2 only after every commander is ready', async () => {
    const port = await availablePort();
    const child = spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), HEARTBEAT_MS: '50', START_COUNTDOWN_MS: '20' },
      stdio: 'ignore',
    });
    children.push(child);
    await waitForHealth(port);

    const host = await connect(port);
    host.send(JSON.stringify({
      type: 'host', requestId: 'host', name: 'Host',
      settings: { armyCount: 4, controllerCount: 4, controllerTeams: [1, 1, 2, 2], seed: 777 },
    }));
    const hostSession = await nextMessage(host, (message) => message.type === 'session');
    const roomCode = hostSession.room.code as string;
    const sessions = [hostSession];
    const clients = [host];
    for (let index = 2; index <= 4; index++) {
      const client = await connect(port);
      client.send(JSON.stringify({ type: 'join', requestId: `join-${index}`, code: roomCode, name: `P${index}` }));
      clients.push(client);
      sessions.push(await nextMessage(client, (message) => message.type === 'session'));
    }
    expect(hostSession.room.armyCount).toBe(2);
    expect(sessions.map((session) => session.player.index)).toEqual([1, 2, 3, 4]);

    const ready = nextMessage(host, (message) => message.type === 'room-state' && message.room.players.length === 4 && message.room.players.every((player: any) => player.ready));
    for (const session of sessions) {
      const client = clients[session.player.index - 1];
      client.send(JSON.stringify({ type: 'set-ready', roomCode, playerId: session.player.id, ready: true }));
    }
    await ready;

    const starts = clients.map((client) => nextMessage(client, (message) => message.type === 'match-start'));
    host.send(JSON.stringify({ type: 'start-match', roomCode, playerId: hostSession.player.id }));
    const events = await Promise.all(starts);
    expect(events.every((event) => event.room.armyCount === 2)).toBe(true);
    expect(events[0].room.armySides).toEqual([1, 2, 3, 4]);

    const relayedTickPackets = clients.map((client, clientIndex) => collectMessages(
      client,
      (message) => message.type === 'command' && message.tick === 4 && message.command?.type === 'tick-ready' && message.playerId !== sessions[clientIndex].player.id,
      3,
    ));
    for (let index = 0; index < clients.length; index++) {
      clients[index].send(JSON.stringify({
        type: 'command',
        roomCode,
        playerId: sessions[index].player.id,
        tick: 4,
        command: { type: 'tick-ready' },
      }));
    }
    const received = await Promise.all(relayedTickPackets);
    expect(received.every((messages) => new Set(messages.map((message) => message.playerId)).size === 3)).toBe(true);
  }, 5000);

  it('assigns four players to two shared armies with Commander and Field Officer seats', async () => {
    const port = await availablePort();
    const child = spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), HEARTBEAT_MS: '50', START_COUNTDOWN_MS: '20' },
      stdio: 'ignore',
    });
    children.push(child);
    await waitForHealth(port);

    const host = await connect(port);
    host.send(JSON.stringify({
      type: 'host', requestId: 'coop-host', name: 'Alpha Commander',
      settings: { armyCount: 2, controllerCount: 4, controllerTeams: [1, 2, 1, 2], playersPerArmy: 2, seed: 8080 },
    }));
    const sessions = [await nextMessage(host, (message) => message.type === 'session')];
    const clients = [host];
    for (let index = 2; index <= 4; index++) {
      const client = await connect(port);
      client.send(JSON.stringify({ type: 'join', requestId: `coop-${index}`, code: sessions[0].room.code, name: `P${index}` }));
      clients.push(client);
      sessions.push(await nextMessage(client, (message) => message.type === 'session'));
    }

    expect(sessions.map((session) => [session.player.armyId, session.player.role])).toEqual([
      [1, 'commander'],
      [2, 'commander'],
      [1, 'field-officer'],
      [2, 'field-officer'],
    ]);
    expect(sessions[0].room.playersPerArmy).toBe(2);

    const fieldUpdate = nextMessage(
      host,
      (message) => message.type === 'room-state' && message.room.players.some((player: any) => player.id === sessions[2].player.id && player.armyId === 1 && player.role === 'field-officer'),
    );
    clients[2].send(JSON.stringify({
      type: 'player-profile', roomCode: sessions[0].room.code, playerId: sessions[2].player.id,
      profile: { armyId: 1, role: 'field-officer' },
    }));
    await fieldUpdate;
  }, 5000);

  it('restores an in-progress room after a relay restart and lets the guest reclaim its slot', async () => {
    const port = await availablePort();
    const child = spawn(process.execPath, ['server/multiplayer-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), HEARTBEAT_MS: '50' },
      stdio: 'ignore',
    });
    children.push(child);
    await waitForHealth(port);

    const hostId = '11111111-1111-4111-8111-111111111111';
    const guestId = '22222222-2222-4222-8222-222222222222';
    const room = {
      code: 'RESUME',
      mapId: 'frostbite-pass',
      mapSize: 'small',
      seed: 771204,
      oreAmount: 150,
      ai: 'easy',
      aiStyle: 'balanced',
      combatMode: 'manual',
      inputDelay: 8,
      armyCount: 2,
      armySides: [1, 2, 3, 4],
      status: 'in-game',
      players: [
        { id: hostId, index: 1, name: 'Host', connected: true, color: 'jade', engine: 'chromium' },
        { id: guestId, index: 2, name: 'Guest', connected: true, color: 'crimson', engine: 'chromium' },
      ],
    };
    const host = await connect(port);
    host.send(JSON.stringify({ type: 'resume-room', requestId: 'resume-host', room, player: room.players[0] }));
    const restored = await nextMessage(host, (message) => message.type === 'session');
    expect(restored.room.code).toBe('RESUME');
    expect(restored.room.status).toBe('in-game');
    expect(restored.room.mapId).toBe('frostbite-pass');
    expect(restored.room.mapSize).toBe('small');
    expect(restored.room.oreAmount).toBe(150);
    expect(restored.player.id).toBe(hostId);

    const guest = await connect(port);
    guest.send(JSON.stringify({ type: 'join', requestId: 'resume-guest', code: 'RESUME', playerId: guestId, name: 'Guest' }));
    const rejoined = await nextMessage(guest, (message) => message.type === 'session');
    expect(rejoined.player.id).toBe(guestId);
    expect(rejoined.player.index).toBe(2);
    expect(rejoined.room.players.every((player: any) => player.connected)).toBe(true);
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

function collectMessages(
  socket: WebSocket,
  predicate: (message: RelayMessage) => boolean,
  count: number,
  timeoutMs = 1000,
): Promise<RelayMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: RelayMessage[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`message timeout (${messages.length}/${count})`));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData): void => {
      const message = JSON.parse(String(raw)) as RelayMessage;
      if (!predicate(message)) return;
      messages.push(message);
      if (messages.length < count) return;
      cleanup();
      resolve(messages);
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
