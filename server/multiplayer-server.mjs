import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const ROOM_TTL_MS = Math.max(1000, Number(process.env.ROOM_TTL_MS ?? 1000 * 60 * 45));
const HEARTBEAT_MS = Math.max(50, Number(process.env.HEARTBEAT_MS ?? 1000 * 5));
const START_COUNTDOWN_MS = Math.max(10, Number(process.env.START_COUNTDOWN_MS ?? 3000));
const RECONNECT_GRACE_MS = Math.max(1000, Number(process.env.RECONNECT_GRACE_MS ?? 60_000));
const MAX_COMMANDS_PER_SECOND = Math.max(30, Number(process.env.MAX_COMMANDS_PER_SECOND ?? 180));
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
 *   mapId: string;
 *   seed: number;
 *   ai: string;
 *   aiStyle: string;
 *   combatMode: 'assisted' | 'manual';
 *   inputDelay: number;
 *   createdAt: number;
 *   updatedAt: number;
 *   status: 'waiting' | 'starting' | 'in-game';
 *   startsAt?: number;
 *   armyCount: 2;
 *   armySides: number[];
 *   players: Array<{ id: string; index: number; name: string; connected: boolean; engine: string; pingMs?: number; joinedAt: number; disconnectedAt?: number }>;
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
        broadcast(room, { type: 'room-closed', reason: `disconnect-timeout:${expiredPlayer.index}` });
        closeRoom(code);
        continue;
      }
      if (expiredPlayer.index === 1) {
        broadcast(room, { type: 'room-closed', reason: 'host-disconnected' });
        closeRoom(code);
        continue;
      }
      room.players = room.players.filter((player) => player !== expiredPlayer);
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
  if (body?.type === 'start-match') return handleStartMatch(socket, body);
  if (body?.type === 'settings') return handleSettings(socket, body);
  if (body?.type === 'command') return handleCommand(socket, body);
  if (body?.type === 'tactical-ping') return handleTacticalPing(socket, body);
  if (body?.type === 'forfeit') return handleForfeit(socket, body);
  if (body?.type === 'pong') return handlePong(socket, body);
  send(socket, { type: 'error', requestId: body?.requestId, error: 'unknown-message' });
}

function handleHost(socket, body) {
  const room = createRoom(body.settings ?? body);
  const host = addPlayer(room, body.name ?? body.settings?.name ?? 'Commander 1', body.playerId, body.engine);
  rooms.set(room.code, room);
  attachSocket(room, host, socket);
  send(socket, { type: 'session', requestId: body.requestId, room: publicRoom(room), player: publicPlayer(host) });
  broadcast(room, roomState(room));
}

function handleJoin(socket, body) {
  const room = rooms.get(normalizeRoomCode(body.code));
  if (!room) return send(socket, { type: 'error', requestId: body.requestId, error: 'room-not-found' });
  const existing = typeof body.playerId === 'string' ? room.players.find((player) => player.id === body.playerId) : undefined;
  const player = existing ?? addPlayer(room, body.name ?? `Commander ${room.players.length + 1}`, body.playerId, body.engine);
  player.connected = true;
  player.disconnectedAt = undefined;
  player.engine = normalizeEngine(body.engine);
  attachSocket(room, player, socket);
  send(socket, { type: 'session', requestId: body.requestId, room: publicRoom(room), player: publicPlayer(player) });
  broadcast(room, roomState(room));
}

function handleStartMatch(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player || player.index !== 1 || room.status !== 'waiting') return;
  const connected = room.players.filter((candidate) => candidate.connected);
  if (connected.length !== 2) return;
  startRoom(room);
}

function handleSettings(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player || player.index !== 1 || room.status !== 'waiting') return;
  const next = body.settings ?? {};
  room.mapId = normalizeMapId(next.mapId ?? room.mapId);
  room.seed = Math.max(1, Math.floor(Number(next.seed) || room.seed));
  room.ai = String(next.ai ?? room.ai);
  room.aiStyle = String(next.aiStyle ?? room.aiStyle);
  room.combatMode = normalizeCombatMode(next.combatMode ?? room.combatMode);
  room.armySides = normalizeArmySides(next.armySides, 2);
  room.updatedAt = Date.now();
  broadcast(room, roomState(room));
}

function handleCommand(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  if (!room || !player || room.status !== 'in-game' || !consumeCommandBudget(socket)) return;
  room.updatedAt = Date.now();
  broadcast(room, {
    type: 'command',
    playerId: player.id,
    playerIndex: player.index,
    tick: Math.max(0, Math.floor(Number(body.tick) || 0)),
    command: body.command ?? {},
  });
}

function handleTacticalPing(socket, body) {
  const { room, player } = roomAndPlayer(body, socket);
  const kind = normalizeTacticalPingKind(body?.kind);
  const x = Number(body?.x);
  const z = Number(body?.z);
  if (!room || !player || room.status !== 'in-game' || !kind || !Number.isFinite(x) || !Number.isFinite(z)) return;
  if (Math.abs(x) > 2000 || Math.abs(z) > 2000 || !consumeCommandBudget(socket)) return;
  room.updatedAt = Date.now();
  broadcastToAllies(room, player.index, {
    type: 'tactical-ping',
    playerId: player.id,
    playerIndex: player.index,
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
  broadcast(room, { type: 'player-forfeit', playerId: player.id, playerIndex: player.index, name: player.name });
  broadcast(room, { type: 'room-closed', reason: `forfeit:${player.index}` });
  setTimeout(() => closeRoom(room.code), 250).unref();
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
  const armySides = normalizeArmySides(body?.armySides, 2);
  return {
    code,
    mapId: normalizeMapId(body?.mapId),
    seed: Math.max(1, Math.floor(Number(body?.seed) || 1)),
    ai: String(body?.ai ?? 'normal'),
    aiStyle: String(body?.aiStyle ?? 'balanced'),
    combatMode: normalizeCombatMode(body?.combatMode),
    inputDelay: 8,
    armyCount: 2,
    armySides,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'waiting',
    players: [],
    clients: new Map(),
  };
}

function addPlayer(room, name, requestedId, engine) {
  let openIndex = 0;
  for (let candidate = 1; candidate <= 2; candidate++) {
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
    name: String(name).slice(0, 28),
    connected: true,
    engine: normalizeEngine(engine),
    joinedAt: Date.now(),
  };
  room.players.push(player);
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
    room.status = 'waiting';
    room.startsAt = undefined;
  }
  room.updatedAt = Date.now();
  broadcast(room, roomState(room));
}

function startRoom(room) {
  if (room.status !== 'waiting') return;
  room.inputDelay = inputDelayForRoom(room);
  room.status = 'starting';
  room.startsAt = Date.now() + START_COUNTDOWN_MS;
  const startsAt = room.startsAt;
  broadcast(room, roomState(room));
  setTimeout(() => {
    if (!rooms.has(room.code) || room.status !== 'starting' || room.startsAt !== startsAt) return;
    room.status = 'in-game';
    room.startsAt = undefined;
    broadcast(room, { type: 'match-start', room: publicRoom(room) });
    broadcast(room, roomState(room));
  }, START_COUNTDOWN_MS);
}

function inputDelayForRoom(room) {
  const worstPing = Math.max(...room.players.map((player) => player.pingMs ?? 80));
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
    mapId: room.mapId,
    seed: room.seed,
    ai: room.ai,
    aiStyle: room.aiStyle,
    combatMode: room.combatMode,
    inputDelay: room.inputDelay,
    armyCount: room.armyCount,
    armySides: room.armySides,
    status: room.status,
    startsAt: room.startsAt,
    players: room.players.map(publicPlayer),
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    index: player.index,
    name: player.name,
    connected: player.connected,
    engine: player.engine,
    pingMs: player.pingMs,
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

function broadcast(room, message) {
  for (const client of room.clients.values()) send(client, message);
}

function broadcastToAllies(room, team, message) {
  const side = room.armySides[team - 1] ?? team;
  for (const player of room.players) {
    if ((room.armySides[player.index - 1] ?? player.index) !== side) continue;
    const client = room.clients.get(player.id);
    if (client) send(client, message);
  }
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function normalizeRoomCode(code) {
  return String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function normalizeCombatMode(value) {
  return value === 'manual' ? 'manual' : 'assisted';
}

function normalizeMapId(value) {
  return value === 'crater-oasis' || value === 'frostbite-pass' ? value : 'highlands';
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
