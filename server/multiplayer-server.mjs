import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787);
const ROOM_TTL_MS = 1000 * 60 * 45;
const HEARTBEAT_MS = 1000 * 10;
const START_COUNTDOWN_MS = 2500;
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
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
 *   createdAt: number;
 *   updatedAt: number;
 *   status: 'waiting' | 'starting' | 'in-game';
 *   startsAt?: number;
 *   armyCount: number;
 *   armySides: number[];
 *   players: Array<{ id: string; index: number; name: string; connected: boolean; joinedAt: number }>;
 *   clients: Map<string, import('node:http').ServerResponse>;
 * }} Room
 */

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    if (err?.statusCode) return sendJson(req, res, err.statusCode, { ok: false, error: err.message });
    console.error('[mp] request failed', err);
    sendJson(req, res, 500, { ok: false, error: 'server-error' });
  }
});

server.listen(PORT, () => {
  console.log(`[mp] Iron Dominion multiplayer relay listening on http://127.0.0.1:${PORT}`);
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) {
      broadcast(room, { type: 'room-closed', reason: 'expired' });
      closeRoom(code);
    } else {
      broadcast(room, { type: 'heartbeat', now });
    }
  }
}, HEARTBEAT_MS).unref();

async function route(req, res) {
  if (!applyCors(req, res)) return sendJson(req, res, 403, { ok: false, error: 'origin-not-allowed' });
  if (req.method === 'OPTIONS') return sendOptions(req, res);

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(req, res, 200, { ok: true, rooms: rooms.size });
  }

  if (req.method === 'GET' && url.pathname === '/rooms') {
    return sendJson(req, res, 200, { ok: true, rooms: Array.from(rooms.values()).map(publicRoom) });
  }

  if (req.method === 'POST' && url.pathname === '/rooms') {
    const body = await readJson(req);
    const room = createRoom(body);
    const host = addPlayer(room, body?.name ?? 'Commander 1', body?.playerId);
    rooms.set(room.code, room);
    room.updatedAt = Date.now();
    broadcast(room, roomState(room));
    return sendJson(req, res, 200, { ok: true, room: publicRoom(room), player: host });
  }

  const match = url.pathname.match(/^\/rooms\/([A-Z0-9]{4,8})(?:\/([a-z-]+))?$/);
  if (!match) return sendJson(req, res, 404, { ok: false, error: 'not-found' });

  const room = rooms.get(match[1]);
  if (!room) return sendJson(req, res, 404, { ok: false, error: 'room-not-found' });
  room.updatedAt = Date.now();
  const action = match[2] ?? '';

  if (req.method === 'GET' && action === 'events') return openEvents(room, url, req, res);
  if (req.method !== 'POST') return sendJson(req, res, 405, { ok: false, error: 'method-not-allowed' });

  const body = await readJson(req);
  if (action === 'join') {
    const existing = body?.playerId ? room.players.find((player) => player.id === body.playerId) : undefined;
    const player = existing ?? addPlayer(room, body?.name ?? `Commander ${room.players.length + 1}`);
    player.connected = true;
    maybeAutoStart(room);
    broadcast(room, roomState(room));
    return sendJson(req, res, 200, { ok: true, room: publicRoom(room), player });
  }
  if (action === 'leave') {
    const player = room.players.find((candidate) => candidate.id === body?.playerId);
    if (player) player.connected = false;
    broadcast(room, roomState(room));
    return sendJson(req, res, 200, { ok: true });
  }
  if (action === 'command') {
    const player = room.players.find((candidate) => candidate.id === body?.playerId);
    if (!player) return sendJson(req, res, 403, { ok: false, error: 'unknown-player' });
    broadcast(room, {
      type: 'command',
      playerId: player.id,
      playerIndex: player.index,
      tick: Math.max(0, Math.floor(Number(body?.tick) || 0)),
      command: body?.command ?? {},
    });
    return sendJson(req, res, 200, { ok: true });
  }
  return sendJson(req, res, 404, { ok: false, error: 'not-found' });
}

function createRoom(body) {
  let code = '';
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  const armyCount = normalizeArmyCount(body?.armyCount);
  return {
    code,
    mapId: normalizeMapId(body?.mapId),
    seed: Math.max(1, Math.floor(Number(body?.seed) || 1)),
    ai: String(body?.ai ?? 'normal'),
    aiStyle: String(body?.aiStyle ?? 'balanced'),
    combatMode: normalizeCombatMode(body?.combatMode),
    armyCount,
    armySides: normalizeArmySides(body?.armySides, armyCount),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'waiting',
    players: [],
    clients: new Map(),
  };
}

function addPlayer(room, name, requestedId) {
  let openIndex = 0;
  for (let candidate = 1; candidate <= room.armyCount; candidate++) {
    if (!room.players.some((player) => player.index === candidate)) {
      openIndex = candidate;
      break;
    }
  }
  if (!openIndex) {
    throw Object.assign(new Error('room-full'), { statusCode: 409 });
  }
  const id = typeof requestedId === 'string' && /^[0-9a-f-]{16,64}$/i.test(requestedId) ? requestedId : randomUUID();
  const player = { id, index: openIndex, name: String(name).slice(0, 28), connected: true, joinedAt: Date.now() };
  room.players.push(player);
  return player;
}

function maybeAutoStart(room) {
  if (room.status !== 'waiting') return;
  if (room.players.filter((player) => player.connected).length >= room.armyCount) {
    room.status = 'starting';
    room.startsAt = Date.now() + START_COUNTDOWN_MS;
    broadcast(room, roomState(room));
    setTimeout(() => {
      if (rooms.has(room.code)) {
        room.status = 'in-game';
        room.startsAt = undefined;
        broadcast(room, { type: 'match-start', room: publicRoom(room) });
        broadcast(room, roomState(room));
      }
    }, START_COUNTDOWN_MS);
  }
}

function openEvents(room, url, req, res) {
  const playerId = url.searchParams.get('playerId');
  if (!playerId || !room.players.some((player) => player.id === playerId)) return sendJson(req, res, 403, { ok: false, error: 'unknown-player' });
  res.writeHead(200, {
    ...corsHeaders(req.headers.origin),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  room.clients.set(playerId, res);
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (player) player.connected = true;
  sendEvent(res, roomState(room));
  req.on('close', () => {
    room.clients.delete(playerId);
    const leaving = room.players.find((candidate) => candidate.id === playerId);
    if (leaving) leaving.connected = false;
    broadcast(room, roomState(room));
  });
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const client of room.clients.values()) client.end();
  rooms.delete(code);
}

function publicRoom(room) {
  return {
    code: room.code,
    mapId: room.mapId,
    seed: room.seed,
    ai: room.ai,
    aiStyle: room.aiStyle,
    combatMode: room.combatMode,
    armyCount: room.armyCount,
    armySides: room.armySides,
    status: room.status,
    startsAt: room.startsAt,
    players: room.players.map((player) => ({
      id: player.id,
      index: player.index,
      name: player.name,
      connected: player.connected,
    })),
  };
}

function normalizeCombatMode(value) {
  return value === 'manual' ? 'manual' : 'assisted';
}

function normalizeMapId(value) {
  return value === 'crater-oasis' || value === 'frostbite-pass' ? value : 'highlands';
}

function normalizeArmyCount(value) {
  const count = Math.floor(Number(value) || 2);
  return Math.max(2, Math.min(4, count));
}

function normalizeArmySides(value, armyCount) {
  const input = Array.isArray(value) ? value : [];
  return Array.from({ length: 4 }, (_, index) => {
    const side = Math.floor(Number(input[index]) || index + 1);
    return index < armyCount ? Math.max(1, Math.min(4, side)) : index + 1;
  });
}

function roomState(room) {
  return { type: 'room-state', room: publicRoom(room) };
}

function broadcast(room, message) {
  for (const client of room.clients.values()) sendEvent(client, message);
}

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw);
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
  if (ALLOWED_ORIGINS.size > 0 && origin && !ALLOWED_ORIGINS.has(origin)) return false;
  for (const [key, value] of Object.entries(corsHeaders(origin))) res.setHeader(key, value);
  return true;
}

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.size === 0 ? '*' : origin && ALLOWED_ORIGINS.has(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}
