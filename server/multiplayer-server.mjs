import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const ROOM_TTL_MS = Math.max(1000, Number(process.env.ROOM_TTL_MS ?? 1000 * 60 * 45));
const HEARTBEAT_MS = Math.max(50, Number(process.env.HEARTBEAT_MS ?? 1000 * 5));
const START_COUNTDOWN_MS = Math.max(10, Number(process.env.START_COUNTDOWN_MS ?? 3000));
const RECONNECT_GRACE_MS = Math.max(1000, Number(process.env.RECONNECT_GRACE_MS ?? 180_000));
const MAX_COMMANDS_PER_SECOND = Math.max(30, Number(process.env.MAX_COMMANDS_PER_SECOND ?? 180));
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const EXPOSE_ROOMS = process.env.EXPOSE_ROOMS === 'true';
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean),
);

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {{
 *   code: string;
 *   matchId?: string;
 *   mapId: string;
 *   mapSize: 'small' | 'medium' | 'large';
 *   seed: number;
 *   oreAmount: number;
 *   terrainRelief: number;
 *   ai: string;
 *   aiStyle: string;
 *   combatMode: 'assisted' | 'manual';
 *   inputDelay: number;
 *   createdAt: number;
 *   updatedAt: number;
 *   status: 'waiting' | 'starting' | 'in-game';
 *   startsAt?: number;
 *   rematchStarting?: boolean;
 *   armyCount: 2 | 3 | 4;
 *   controllerCount: 2 | 3 | 4;
 *   controllerTeams: number[];
 *   playersPerArmy: 1 | 2;
 *   armySides: number[];
 *   spawnSlots: number[];
 *   hostPlayerId: string;
 *   players: Array<{ id: string; index: number; armyId: number; role: 'commander' | 'field-officer'; name: string; color: string; ready: boolean; rematchReady: boolean; connected: boolean; engine: string; pingMs?: number; joinedAt: number; disconnectedAt?: number }>;
 *   clients: Map<string, import('ws').WebSocket>;
 * }} Room
 */

const server = createServer((req, res) => {
  if (!applyCors(req, res)) return sendJson(req, res, 403, { ok: false, error: 'origin-not-allowed' });
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(req, res, 200, { ok: true, rooms: rooms.size, transport: 'websocket' });
  if (EXPOSE_ROOMS && req.method === 'GET' && url.pathname === '/rooms') return sendJson(req, res, 200, { ok: true, rooms: Array.from(rooms.values()).map(publicRoom) });
  return sendJson(req, res, 404, { ok: false, error: 'not-found' });
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 8 * 1024 * 1024,
  verifyClient(info, done) {
    if (ALLOWED_ORIGINS.size === 0) return done(true);
    const origin = info.origin;
    return done(Boolean(origin) && ALLOWED_ORIGINS.has(normalizeOrigin(origin)), 403, 'origin-not-allowed');
  },
});

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    try {
      routeSocket(socket, JSON.parse(String(raw)));
    } catch (err) {
      send(socket, { type: 'error', error: err?.message ?? 'server-error' });
    }
  });
  socket.on('close', () => detachSocket(socket));
  socket.on('error', () => detachSocket(socket));
});

server.listen(PORT, () => {
  console.log(`[mp] Iron Dominion WebSocket relay listening on http://127.0.0.1:${PORT}`);
});

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) {
      broadcast(room, { type: 'room-closed', reason: 'expired' });
      closeRoom(code);
      continue;
    }
    const expiredPlayer = room.players.find(
      (player) => !player.connected && player.disconnectedAt && now - player.disconnectedAt >= RECONNECT_GRACE_MS,
    );
    if (expiredPlayer) {
      if (room.status === 'in-game') {
        const teammate = room.players.find(
          (player) => player.id !== expiredPlayer.id && player.armyId === expiredPlayer.armyId && player.connected,
        );
        if (!teammate) {
          broadcast(room, { type: 'room-closed', reason: `disconnect-timeout:${expiredPlayer.armyId}` });
          closeRoom(code);
          continue;
        }
        room.players = room.players.filter((player) => player !== expiredPlayer);
        if (expiredPlayer.role === 'commander') teammate.role = 'commander';
        if (room.hostPlayerId === expiredPlayer.id) room.hostPlayerId = electHost(room)?.id ?? teammate.id;
        room.updatedAt = now;
        broadcast(room, roomState(room));
        continue;
      }
      const waitingTeammate = room.players.find(
        (player) => player.id !== expiredPlayer.id && player.armyId === expiredPlayer.armyId && player.connected,
      );
      if (expiredPlayer.id === room.hostPlayerId && !waitingTeammate) {
        broadcast(room, { type: 'room-closed', reason: 'host-disconnected' });
        closeRoom(code);
        continue;
      }
      room.players = room.players.filter((player) => player !== expiredPlayer);
      if (expiredPlayer.role === 'commander' && waitingTeammate) waitingTeammate.role = 'commander';
      if (room.hostPlayerId === expiredPlayer.id) room.hostPlayerId = electHost(room)?.id ?? '';
      room.updatedAt = now;
      broadcast(room, roomState(room));
    }
    for (const [playerId, socket] of room.clients) {
      const nonce = randomUUID();
      socket._lastPing = { nonce, sentAt: now, roomCode: room.code, playerId };
      send(socket, { type: 'ping', nonce, sentAt: now });
    }
    broadcast(room, { type: 'heartbeat', now });
  }
}, HEARTBEAT_MS).unref();

function routeSocket(socket, body) {
  if (body?.type === 'host') return handleHost(socket, body);
  if (body?.type === 'join') return handleJoin(socket, body);
  if (body?.type === 'resume-room') return handleResumeRoom(socket, body);
  if (body?.type === 'start-match') return handleStartMatch(socket, body);
  if (body?.type === 'settings') return handleSettings(socket, body);
  if (body?.type === 'set-ready') return handleSetReady(socket, body);
  if (body?.type === 'player-profile') return handlePlayerProfile(socket, body);
  if (body?.type === 'request-rematch') return handleRequestRematch(socket, body);
  if (body?.type === 'command') return handleCommand(socket, body);
  if (body?.type === 'tactical-ping') return handleTacticalPing(socket, body);
  if (body?.type === 'forfeit') return handleForfeit(socket, body);
  if (body?.type === 'pong') return handlePong(socket, body);
  send(socket, { type: 'error', requestId: body?.requestId, error: 'unknown-message' });
}

function handleHost(socket, body) {
  const room = createRoom(body.settings ?? body);
  const host = addPlayer(room, body.name ?? body.settings?.name ?? 'Commander 1', body.playerId, body.engine);
  room.hostPlayerId = host.id;
  rooms.set(room.code, room);
  attachSocket(room, host, socket);
  send(socket, { type: 'session', requestId: body.requestId, room: publicRoom(room), player: publicPlayer(host) });
  broadcast(room, roomState(room));
}

function handleJoin(socket, body) {
  const room = rooms.get(normalizeRoomCode(body.code));
  if (!room) return send(socket, { type: 'error', requestId: body.requestId, error: 'room-not-found' });
  const existing = typeof body.playerId === 'string' ? room.players.find((player) => player.id === body.playerId) : undefined;
  if (!existing && room.status !== 'waiting') return send(socket, { type: 'error', requestId: body.requestId, error: 'match-in-progress' });
  const player = existing ?? addPlayer(room, body.name ?? `Commander ${room.players.length + 1}`, body.playerId, body.engine);
  player.connected = true;
  player.disconnectedAt = undefined;
  player.engine = normalizeEngine(body.engine);
  attachSocket(room, player, socket);
  send(socket, { type: 'session', requestId: body.requestId, room: publicRoom(room), player: publicPlayer(player) });
  broadcast(room, roomState(room));
}

function handleResumeRoom(socket, body) {
  const snapshot = body?.room;
  const requestedPlayer = body?.player;
  const code = normalizeRoomCode(snapshot?.code);
  const snapshotHostId = typeof snapshot?.hostPlayerId === 'string'
    ? snapshot.hostPlayerId
    : Array.isArray(snapshot?.players) ? snapshot.players.find((player) => player?.index === 1)?.id : undefined;
  if (!code || requestedPlayer?.id !== snapshotHostId) {
    return send(socket, { type: 'error', requestId: body.requestId, error: 'invalid-resume' });
  }
  const existingRoom = rooms.get(code);
  if (existingRoom) {
    return handleJoin(socket, {
      ...body,
      type: 'join',
      code,
      name: requestedPlayer.name,
      playerId: requestedPlayer.id,
    });
  }
  const room = restoreRoom(snapshot);
  const host = room.players.find((player) => player.id === room.hostPlayerId);
  if (!host) return send(socket, { type: 'error', requestId: body.requestId, error: 'invalid-resume' });
  rooms.set(room.code, room);
  attachSocket(room, host, socket);
  send(socket, { type: 'session', requestId: body.requestId, room: publicRoom(room), player: publicPlayer(host) });
  broadcast(room, roomState(room));
}

function handleStartMatch(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player || player.id !== room.hostPlayerId || room.status !== 'waiting') return;
  const connected = room.players.filter((candidate) => candidate.connected);
  if (connected.length === 0 || !connected.every((candidate) => candidate.ready)) return;
  ensureOpenAiOpponent(room, connected);
  startRoom(room);
}

function handleSettings(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player || player.id !== room.hostPlayerId || room.status !== 'waiting') return;
  const next = body.settings ?? {};
  room.mapId = normalizeMapId(next.mapId ?? room.mapId);
  room.mapSize = normalizeMapSize(next.mapSize ?? room.mapSize);
  room.seed = Math.max(1, Math.floor(Number(next.seed) || room.seed));
  room.oreAmount = normalizeOreAmount(next.oreAmount ?? room.oreAmount);
  room.terrainRelief = normalizeTerrainRelief(next.terrainRelief ?? room.terrainRelief, room.mapId);
  room.ai = String(next.ai ?? room.ai);
  room.aiStyle = String(next.aiStyle ?? room.aiStyle);
  room.combatMode = normalizeCombatMode(next.combatMode ?? room.combatMode);
  const requestedControllerCount = normalizeControllerCount(
    next.controllerCount ?? next.armyCount ?? room.controllerCount,
  );
  if (room.players.every((candidate) => candidate.index <= requestedControllerCount)) {
    room.controllerCount = requestedControllerCount;
    room.controllerTeams = normalizeControllerTeams(
      next.controllerTeams ?? room.controllerTeams,
      room.controllerCount,
    );
  }
  room.playersPerArmy = 2;
  reconcileControllerAssignments(room);
  room.spawnSlots = normalizeSpawnSlots(next.spawnSlots ?? room.spawnSlots);
  for (const candidate of room.players) candidate.ready = false;
  room.updatedAt = Date.now();
  broadcast(room, roomState(room));
}

function handleSetReady(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player || room.status !== 'waiting') return;
  player.ready = body.ready === true;
  room.updatedAt = Date.now();
  broadcast(room, roomState(room));
}

function handlePlayerProfile(socket, body) {
  const { room, player: actor } = roomAndPlayer(body, socket);
  if (!room || !actor || room.status !== 'waiting') return;
  const requestedTarget = typeof body.targetPlayerId === 'string'
    ? room.players.find((candidate) => candidate.id === body.targetPlayerId)
    : undefined;
  const player = requestedTarget && actor.id === room.hostPlayerId ? requestedTarget : actor;
  const profile = body.profile ?? {};
  const isRoomHost = player.id === room.hostPlayerId;
  if (typeof profile.name === 'string') player.name = normalizePlayerName(profile.name, player.index);
  const requestedTeam = normalizeLobbyTeam(profile.team ?? profile.armyId);
  if (requestedTeam && actor.id === room.hostPlayerId) {
    const nextTeams = [...room.controllerTeams];
    nextTeams[player.index - 1] = requestedTeam;
    room.controllerTeams = normalizeControllerTeams(nextTeams, room.controllerCount);
    reconcileControllerAssignments(room);
    for (const candidate of room.players) candidate.ready = false;
  }
  if (isRoomHost) player.role = 'commander';
  if (normalizePlayerColor(profile.color) && player.role === 'commander') {
    const color = normalizePlayerColor(profile.color);
    for (const teammate of room.players.filter((candidate) => candidate.armyId === player.armyId)) teammate.color = color;
  }
  player.ready = false;
  room.updatedAt = Date.now();
  broadcast(room, roomState(room));
}

function handleRequestRematch(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player || room.status !== 'in-game') return;
  player.rematchReady = true;
  room.updatedAt = Date.now();
  const connected = room.players.filter((candidate) => candidate.connected);
  if (connected.length > 0 && connected.every((candidate) => candidate.rematchReady)) startRematch(room);
  else broadcast(room, roomState(room));
}

function handleCommand(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player || room.status !== 'in-game' || !consumeCommandBudget(socket)) return;
  room.updatedAt = Date.now();
  broadcast(room, {
    type: 'command',
    playerId: player.id,
    playerIndex: player.index,
    armyId: player.armyId,
    tick: Math.max(0, Math.floor(Number(body.tick) || 0)),
    command: body.command ?? {},
  }, player.id);
}

function handleTacticalPing(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  const kind = normalizeTacticalPingKind(body?.kind);
  const x = Number(body?.x);
  const z = Number(body?.z);
  if (!room || !player || room.status !== 'in-game' || !kind || !Number.isFinite(x) || !Number.isFinite(z)) return;
  if (Math.abs(x) > 2000 || Math.abs(z) > 2000 || !consumeCommandBudget(socket)) return;
  room.updatedAt = Date.now();
  broadcastToAllies(room, player.armyId, {
    type: 'tactical-ping',
    playerId: player.id,
    playerIndex: player.index,
    armyId: player.armyId,
    name: player.name,
    kind,
    x: Math.round(x * 10) / 10,
    z: Math.round(z * 10) / 10,
  });
}

function handleForfeit(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player) return;
  room.updatedAt = Date.now();
  const teammate = room.players.find(
    (candidate) => candidate.id !== player.id && candidate.armyId === player.armyId && candidate.connected,
  );
  const armyDefeated = !teammate;
  broadcast(room, {
    type: 'player-forfeit',
    playerId: player.id,
    playerIndex: player.index,
    armyId: player.armyId,
    name: player.name,
    armyDefeated,
  });
  if (armyDefeated) {
    broadcast(room, { type: 'room-closed', reason: `forfeit:${player.armyId}` });
    setTimeout(() => closeRoom(room.code), 250).unref();
    return;
  }
  if (player.role === 'commander') teammate.role = 'commander';
  room.players = room.players.filter((candidate) => candidate.id !== player.id);
  room.clients.delete(player.id);
  if (room.hostPlayerId === player.id) room.hostPlayerId = electHost(room)?.id ?? teammate.id;
  broadcast(room, roomState(room));
  setTimeout(() => socket.close(1000, 'player-left'), 25).unref();
}

function handlePong(socket, body) {
  const last = socket._lastPing;
  if (!last || body.nonce !== last.nonce) return;
  const room = rooms.get(last.roomCode);
  const player = room?.players.find((candidate) => candidate.id === last.playerId);
  if (!room || !player) return;
  player.pingMs = Math.max(1, Math.min(999, Math.round(Date.now() - last.sentAt)));
  room.updatedAt = Date.now();
  broadcast(room, roomState(room));
}

function createRoom(body) {
  let code = '';
  do {
    code = randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X');
  } while (rooms.has(code));
  const legacyArmyCount = normalizeArmyCount(body?.armyCount);
  const legacyPlayersPerArmy = normalizePlayersPerArmy(body?.playersPerArmy);
  const controllerCount = normalizeControllerCount(
    body?.controllerCount ?? Math.min(4, legacyArmyCount * legacyPlayersPerArmy),
  );
  const controllerTeams = normalizeControllerTeams(body?.controllerTeams, controllerCount);
  const armyCount = Math.max(2, new Set(controllerTeams.slice(0, controllerCount)).size);
  const armySides = normalizeArmySides(undefined, armyCount);
  const spawnSlots = normalizeSpawnSlots(body?.spawnSlots);
  return {
    code,
    mapId: normalizeMapId(body?.mapId),
    mapSize: normalizeMapSize(body?.mapSize),
    seed: Math.max(1, Math.floor(Number(body?.seed) || 1)),
    oreAmount: normalizeOreAmount(body?.oreAmount),
    terrainRelief: normalizeTerrainRelief(body?.terrainRelief, normalizeMapId(body?.mapId)),
    ai: String(body?.ai ?? 'normal'),
    aiStyle: String(body?.aiStyle ?? 'balanced'),
    combatMode: normalizeCombatMode(body?.combatMode),
    inputDelay: 8,
    armyCount,
    controllerCount,
    controllerTeams,
    playersPerArmy: 2,
    armySides,
    spawnSlots,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'waiting',
    hostPlayerId: '',
    players: [],
    clients: new Map(),
  };
}

function restoreRoom(snapshot) {
  const controllerCount = normalizeControllerCount(snapshot?.controllerCount ?? snapshot?.armyCount);
  const controllerTeams = normalizeControllerTeams(snapshot?.controllerTeams, controllerCount);
  const armyCount = Math.max(2, new Set(controllerTeams.slice(0, controllerCount)).size);
  const playersPerArmy = 2;
  const now = Date.now();
  const room = {
    code: normalizeRoomCode(snapshot?.code),
    matchId: typeof snapshot?.matchId === 'string' && /^[0-9a-f-]{16,64}$/i.test(snapshot.matchId) ? snapshot.matchId : randomUUID(),
    mapId: normalizeMapId(snapshot?.mapId),
    mapSize: normalizeMapSize(snapshot?.mapSize),
    seed: Math.max(1, Math.floor(Number(snapshot?.seed) || 1)),
    oreAmount: normalizeOreAmount(snapshot?.oreAmount),
    terrainRelief: normalizeTerrainRelief(snapshot?.terrainRelief, normalizeMapId(snapshot?.mapId)),
    ai: String(snapshot?.ai ?? 'normal'),
    aiStyle: String(snapshot?.aiStyle ?? 'balanced'),
    combatMode: normalizeCombatMode(snapshot?.combatMode),
    inputDelay: Math.max(4, Math.min(12, Math.floor(Number(snapshot?.inputDelay) || 8))),
    armyCount,
    controllerCount,
    controllerTeams,
    playersPerArmy,
    armySides: normalizeArmySides(snapshot?.armySides, armyCount),
    spawnSlots: normalizeSpawnSlots(snapshot?.spawnSlots),
    createdAt: now,
    updatedAt: now,
    status: 'in-game',
    hostPlayerId: typeof snapshot?.hostPlayerId === 'string' ? snapshot.hostPlayerId : '',
    players: [],
    clients: new Map(),
  };
  const sourcePlayers = Array.isArray(snapshot?.players) ? snapshot.players : [];
  room.players = sourcePlayers.slice(0, controllerCount).map((source, offset) => ({
    id: typeof source?.id === 'string' && /^[0-9a-f-]{16,64}$/i.test(source.id) ? source.id : randomUUID(),
    index: Math.max(1, Math.min(controllerCount, Math.floor(Number(source?.index) || offset + 1))),
    lobbyTeam: normalizeLobbyTeam(source?.lobbyTeam) ?? controllerTeams[offset] ?? offset + 1,
    armyId: normalizeArmyId(source?.armyId ?? source?.index, armyCount) ?? Math.min(armyCount, offset + 1),
    role: normalizePlayerRole(source?.role) ?? 'commander',
    name: normalizePlayerName(source?.name, offset + 1),
    color: normalizePlayerColor(source?.color) ?? defaultPlayerColor(offset + 1),
    ready: true,
    rematchReady: false,
    connected: false,
    engine: normalizeEngine(source?.engine),
    joinedAt: now,
    disconnectedAt: now,
  }));
  if (!room.hostPlayerId || !room.players.some((player) => player.id === room.hostPlayerId)) {
    room.hostPlayerId = room.players.find((player) => player.index === 1)?.id ?? room.players[0]?.id ?? '';
  }
  reconcileControllerAssignments(room);
  return room;
}

function addPlayer(room, name, requestedId, engine) {
  let openIndex = 0;
  for (let candidate = 1; candidate <= room.controllerCount; candidate++) {
    if (!room.players.some((player) => player.index === candidate)) {
      openIndex = candidate;
      break;
    }
  }
  if (!openIndex) throw Object.assign(new Error('room-full'), { statusCode: 409 });
  const id = typeof requestedId === 'string' && /^[0-9a-f-]{16,64}$/i.test(requestedId) ? requestedId : randomUUID();
  const player = {
    id,
    index: openIndex,
    lobbyTeam: room.controllerTeams[openIndex - 1] ?? openIndex,
    armyId: 1,
    role: 'commander',
    name: normalizePlayerName(name, openIndex),
    color: defaultPlayerColor(openIndex),
    ready: false,
    rematchReady: false,
    connected: true,
    engine: normalizeEngine(engine),
    joinedAt: Date.now(),
  };
  room.players.push(player);
  reconcileControllerAssignments(room);
  return player;
}

function attachSocket(room, player, socket) {
  detachSocket(socket);
  socket._roomCode = room.code;
  socket._playerId = player.id;
  const previous = room.clients.get(player.id);
  if (previous && previous !== socket) previous.close();
  room.clients.set(player.id, socket);
  player.connected = true;
  player.disconnectedAt = undefined;
  room.updatedAt = Date.now();
}

function detachSocket(socket) {
  const room = socket._roomCode ? rooms.get(socket._roomCode) : undefined;
  if (!room || !socket._playerId) return;
  if (room.clients.get(socket._playerId) !== socket) return;
  room.clients.delete(socket._playerId);
  const player = room.players.find((candidate) => candidate.id === socket._playerId);
  if (player) {
    player.connected = false;
    player.disconnectedAt = Date.now();
  }
  if (room.status === 'starting') {
    if (!room.rematchStarting) {
      room.status = 'waiting';
      room.startsAt = undefined;
    }
  }
  room.updatedAt = Date.now();
  broadcast(room, roomState(room));
}

function startRoom(room) {
  if (room.status !== 'waiting') return;
  room.matchId = randomUUID();
  room.players = room.players.filter((player) => player.connected);
  room.inputDelay = inputDelayForRoom(room);
  room.status = 'starting';
  room.rematchStarting = false;
  room.startsAt = Date.now() + START_COUNTDOWN_MS;
  const startsAt = room.startsAt;
  broadcast(room, roomState(room));
  setTimeout(() => {
    if (!rooms.has(room.code) || room.status !== 'starting' || room.startsAt !== startsAt) return;
    room.status = 'in-game';
    room.startsAt = undefined;
    room.rematchStarting = false;
    broadcast(room, { type: 'match-start', room: publicRoom(room) });
    broadcast(room, roomState(room));
  }, START_COUNTDOWN_MS);
}

function startRematch(room) {
  room.matchId = randomUUID();
  room.status = 'starting';
  room.rematchStarting = true;
  room.startsAt = Date.now() + START_COUNTDOWN_MS;
  for (const player of room.players) {
    player.ready = false;
    player.rematchReady = false;
  }
  const startsAt = room.startsAt;
  broadcast(room, roomState(room));
  setTimeout(() => {
    if (!rooms.has(room.code) || room.status !== 'starting' || room.startsAt !== startsAt) return;
    room.status = 'in-game';
    room.startsAt = undefined;
    room.rematchStarting = false;
    broadcast(room, { type: 'match-start', room: publicRoom(room), rematch: true });
    broadcast(room, roomState(room));
  }, START_COUNTDOWN_MS);
}

function inputDelayForRoom(room) {
  const worstPing = Math.max(...room.players.map((player) => player.pingMs ?? 160));
  if (worstPing <= 80) return 4;
  if (worstPing <= 180) return 8;
  return 12;
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const client of room.clients.values()) client.close();
  rooms.delete(code);
}

function shutdown() {
  for (const code of Array.from(rooms.keys())) closeRoom(code);
  wss.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 2000).unref();
}

function publicRoom(room) {
  return {
    code: room.code,
    matchId: room.matchId,
    mapId: room.mapId,
    mapSize: room.mapSize,
    seed: room.seed,
    oreAmount: room.oreAmount,
    terrainRelief: room.terrainRelief,
    ai: room.ai,
    aiStyle: room.aiStyle,
    combatMode: room.combatMode,
    inputDelay: room.inputDelay,
    armyCount: room.armyCount,
    controllerCount: room.controllerCount,
    controllerTeams: room.controllerTeams,
    playersPerArmy: room.playersPerArmy,
    armySides: room.armySides,
    spawnSlots: room.spawnSlots,
    status: room.status,
    startsAt: room.startsAt,
    hostPlayerId: room.hostPlayerId,
    players: room.players.map(publicPlayer),
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    index: player.index,
    armyId: player.armyId,
    lobbyTeam: player.lobbyTeam,
    role: player.role,
    name: player.name,
    connected: player.connected,
    engine: player.engine,
    pingMs: player.pingMs,
    color: player.color,
    ready: player.ready,
    rematchReady: player.rematchReady,
  };
}

function roomAndPlayer(body, socket) {
  const room = rooms.get(normalizeRoomCode(body?.roomCode));
  const player = room?.players.find((candidate) => candidate.id === body?.playerId);
  if (!room || !player || socket?._roomCode !== room.code || socket?._playerId !== player.id) return {};
  return { room, player };
}

function consumeCommandBudget(socket) {
  const now = Date.now();
  const budget = socket._commandBudget;
  if (!budget || now - budget.startedAt >= 1000) {
    socket._commandBudget = { startedAt: now, count: 1 };
    return true;
  }
  budget.count++;
  return budget.count <= MAX_COMMANDS_PER_SECOND;
}

function roomState(room) {
  return { type: 'room-state', room: publicRoom(room) };
}

function broadcast(room, message, excludePlayerId) {
  for (const [playerId, client] of room.clients) {
    if (playerId !== excludePlayerId) send(client, message);
  }
}

function broadcastToAllies(room, team, message) {
  const side = room.armySides[team - 1] ?? team;
  for (const player of room.players) {
    if ((room.armySides[player.armyId - 1] ?? player.armyId) !== side) continue;
    const client = room.clients.get(player.id);
    if (client) send(client, message);
  }
}

function send(socket, payload) {
  if (socket.readyState !== socket.OPEN) return false;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.close(1013, 'slow-client');
    return false;
  }
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    socket.close(1011, 'send-failed');
    return false;
  }
}

function normalizeRoomCode(code) {
  return String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function normalizeCombatMode(value) {
  return value === 'manual' ? 'manual' : 'assisted';
}

function normalizeOreAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 100;
  return Math.max(50, Math.min(200, Math.round(amount / 25) * 25));
}

function normalizeTerrainRelief(value, mapId = 'highlands') {
  const relief = Number(value);
  const fallback = mapId === 'crater-oasis' ? 125 : mapId === 'frostbite-pass' ? 100 : 75;
  if (!Number.isFinite(relief)) return fallback;
  return Math.max(50, Math.min(150, Math.round(relief / 25) * 25));
}

function normalizeMapId(value) {
  return value === 'crater-oasis' || value === 'frostbite-pass' ? value : 'highlands';
}

function normalizeMapSize(value) {
  return value === 'small' || value === 'large' ? value : 'medium';
}

function normalizeTacticalPingKind(value) {
  return value === 'attack' || value === 'help' || value === 'defend' || value === 'good-game' ? value : undefined;
}

function normalizeEngine(value) {
  const engine = String(value ?? 'unknown').toLowerCase();
  if (engine.includes('webkit')) return 'webkit';
  if (engine.includes('gecko')) return 'gecko';
  if (engine.includes('chrom')) return 'chromium';
  return engine || 'unknown';
}

function normalizeArmySides(value, armyCount) {
  const input = Array.isArray(value) ? value : [];
  return Array.from({ length: 4 }, (_, index) => {
    const side = Math.floor(Number(input[index]) || index + 1);
    return index < armyCount ? Math.max(1, Math.min(4, side)) : index + 1;
  });
}

function normalizeSpawnSlots(value) {
  const input = Array.isArray(value) ? value : [];
  const used = new Set();
  const result = [];
  for (let index = 0; index < 4; index++) {
    const requested = Math.max(1, Math.min(4, Math.floor(Number(input[index]) || index + 1)));
    const slot = used.has(requested) ? [1, 2, 3, 4].find((candidate) => !used.has(candidate)) : requested;
    result.push(slot ?? index + 1);
    used.add(slot ?? index + 1);
  }
  return result;
}

function ensureOpenAiOpponent(room, connectedPlayers) {
  const activeSides = room.armySides.slice(0, room.armyCount);
  if (new Set(activeSides).size > 1) return;
  const occupied = new Set(connectedPlayers.map((player) => player.armyId));
  const openArmy = Array.from({ length: room.armyCount }, (_, index) => index + 1).find((index) => !occupied.has(index));
  if (!openArmy) return;
  const alliedSide = activeSides[0] ?? 1;
  room.armySides[openArmy - 1] = alliedSide === 1 ? 2 : 1;
}

function normalizeArmyCount(value) {
  const count = Math.floor(Number(value));
  return count === 3 || count === 4 ? count : 2;
}

function normalizeControllerCount(value) {
  const count = Math.floor(Number(value));
  return count === 3 || count === 4 ? count : 2;
}

function normalizeLobbyTeam(value) {
  const team = Math.floor(Number(value));
  return team >= 1 && team <= 4 ? team : undefined;
}

function normalizeControllerTeams(value, controllerCount) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 4 }, (_, index) => (
    index < controllerCount
      ? normalizeLobbyTeam(source[index]) ?? index + 1
      : index + 1
  ));
}

function reconcileControllerAssignments(room) {
  room.controllerCount = normalizeControllerCount(room.controllerCount);
  room.controllerTeams = normalizeControllerTeams(room.controllerTeams, room.controllerCount);
  const activeTeams = room.controllerTeams.slice(0, room.controllerCount);
  if (new Set(activeTeams).size < 2) {
    activeTeams[activeTeams.length - 1] = activeTeams[0] === 1 ? 2 : 1;
    room.controllerTeams[activeTeams.length - 1] = activeTeams[activeTeams.length - 1];
  }
  const labels = Array.from(new Set(activeTeams));
  const actualArmy = new Map(labels.map((team, index) => [team, index + 1]));
  room.armyCount = Math.max(2, labels.length);
  room.armySides = Array.from({ length: 4 }, (_, index) => index + 1);

  const ordered = [...room.players].sort((a, b) => {
    if (a.id === room.hostPlayerId) return -1;
    if (b.id === room.hostPlayerId) return 1;
    return a.index - b.index;
  });
  const commanders = new Set();
  for (const player of ordered) {
    player.lobbyTeam = room.controllerTeams[player.index - 1] ?? player.index;
    player.armyId = actualArmy.get(player.lobbyTeam) ?? 1;
    player.role = commanders.has(player.armyId) ? 'field-officer' : 'commander';
    commanders.add(player.armyId);
  }
  for (const player of ordered) {
    const commander = ordered.find((candidate) => candidate.armyId === player.armyId && candidate.role === 'commander');
    player.color = commander?.color ?? defaultPlayerColor(player.armyId);
  }
}

function normalizePlayersPerArmy(value) {
  return Number(value) === 2 ? 2 : 1;
}

function normalizeArmyId(value, armyCount) {
  const armyId = Math.floor(Number(value));
  return armyId >= 1 && armyId <= armyCount ? armyId : undefined;
}

function normalizePlayerRole(value) {
  return value === 'field-officer' ? 'field-officer' : value === 'commander' ? 'commander' : undefined;
}

function commanderForArmy(room, armyId) {
  return room.players.find((player) => player.armyId === armyId && player.role === 'commander');
}

function seatAvailable(room, playerId, armyId, role) {
  if (role === 'field-officer' && room.playersPerArmy < 2) return false;
  if (role === 'field-officer' && !room.players.some((player) => player.id !== playerId && player.armyId === armyId && player.role === 'commander')) return false;
  return !room.players.some(
    (player) => player.id !== playerId && player.armyId === armyId && player.role === role,
  );
}

function nextOpenSeat(room) {
  for (let armyId = 1; armyId <= room.armyCount; armyId++) {
    if (seatAvailable(room, '', armyId, 'commander')) return { armyId, role: 'commander' };
  }
  if (room.playersPerArmy === 2) {
    for (let armyId = 1; armyId <= room.armyCount; armyId++) {
      if (seatAvailable(room, '', armyId, 'field-officer')) return { armyId, role: 'field-officer' };
    }
  }
  return undefined;
}

function armiesFitSeatLimit(players, playersPerArmy) {
  const counts = new Map();
  for (const player of players) counts.set(player.armyId, (counts.get(player.armyId) ?? 0) + 1);
  return Array.from(counts.values()).every((count) => count <= playersPerArmy);
}

function normalizeRestoredSeats(room) {
  const occupied = new Set();
  for (const player of room.players.sort((a, b) => a.index - b.index)) {
    let key = `${player.armyId}:${player.role}`;
    if (occupied.has(key) || (player.role === 'field-officer' && room.playersPerArmy < 2)) {
      const seat = nextOpenSeat({ ...room, players: room.players.filter((candidate) => occupied.has(`${candidate.armyId}:${candidate.role}`)) });
      if (seat) {
        player.armyId = seat.armyId;
        player.role = seat.role;
        key = `${seat.armyId}:${seat.role}`;
      }
    }
    occupied.add(key);
  }
}

function electHost(room) {
  return room.players.filter((player) => player.connected).sort((a, b) => a.index - b.index)[0];
}

function normalizeSide(value) {
  return Math.max(1, Math.min(4, Math.floor(Number(value) || 1)));
}

function normalizePlayerName(value, index) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return name || `Commander ${index}`;
}

function normalizePlayerColor(value) {
  return value === 'jade' || value === 'crimson' || value === 'azure' || value === 'amber' ? value : undefined;
}

function defaultPlayerColor(index) {
  return ['jade', 'crimson', 'azure', 'amber'][Math.max(0, Math.min(3, index - 1))];
}

function sendOptions(req, res) {
  res.writeHead(204, corsHeaders(req.headers.origin));
  res.end();
}

function sendJson(req, res, status, payload) {
  applyCors(req, res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.size > 0 && origin && !ALLOWED_ORIGINS.has(normalizeOrigin(origin))) return false;
  for (const [key, value] of Object.entries(corsHeaders(origin))) res.setHeader(key, value);
  return true;
}

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.size === 0
    ? '*'
    : origin && ALLOWED_ORIGINS.has(normalizeOrigin(origin)) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function normalizeOrigin(value) {
  const origin = String(value ?? '').trim();
  if (!origin) return '';
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, '');
  }
}
