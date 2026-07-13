import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { createEconomy, createInitialBase } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { serializeMatchState } from '../sim/serialize';
import { createGameSim, hashSim, spawnTankAt, type GameSim } from '../sim/world';
import { LockstepRuntime } from './commands';
import type { MultiplayerClient, MultiplayerSession } from './multiplayer';

describe('multiplayer lockstep commands', () => {
  it('applies delayed team-2 move commands to team-2 units', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy1 = createEconomy(1);
    const economy2 = createEconomy(2);
    createInitialBase(sim, hf, economy1);
    createInitialBase(sim, hf, economy2);
    const guestTank = spawnTankAt(sim, 42, 42, 'Guest Tank', 2);
    const hostTank = spawnTankAt(sim, 30, 30, 'Host Tank', 1);
    const sent: unknown[] = [];
    const client = {
      connect: () => undefined,
      disconnect: () => undefined,
      sendCommand: async (_room: string, _playerId: string, _tick: number, command: unknown) => {
        sent.push(command);
      },
    } as unknown as MultiplayerClient;
    const session: MultiplayerSession = {
      player: { id: 'guest', index: 2, name: 'Guest', connected: true },
      room: { code: 'ABCD', seed: 1, ai: 'normal', aiStyle: 'balanced', armyCount: 2, armySides: [1, 2, 3, 4], status: 'in-game', players: [] },
    };
    const lockstep = new LockstepRuntime({ sim, hf, economies: { 1: economy1, 2: economy2 }, client, session });
    lockstep.connect();
    expect(lockstep.issue({ type: 'move', ids: [guestTank.id, hostTank.id], x: 80, z: 76, attackMove: false })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(guestTank.mover?.target).toBeUndefined();
    for (let i = 0; i < 8; i++) {
      sim.tick++;
      lockstep.tick();
    }
    expect(guestTank.mover?.target).toEqual({ x: 80, z: 76 });
    expect(hostTank.mover?.target).toBeUndefined();
  });

  it('continues applying local queued commands during a stream interruption', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy1 = createEconomy(1);
    const economy2 = createEconomy(2);
    createInitialBase(sim, hf, economy1);
    createInitialBase(sim, hf, economy2);
    const tank = spawnTankAt(sim, 30, 30, 'Host Tank', 1);
    const sent: unknown[] = [];
    const client = {
      connect: () => undefined,
      disconnect: () => undefined,
      sendCommand: async (_room: string, _playerId: string, _tick: number, command: unknown) => {
        sent.push(command);
      },
    } as unknown as MultiplayerClient;
    const session: MultiplayerSession = {
      player: { id: 'host', index: 1, name: 'Host', connected: true },
      room: { code: 'ABCD', seed: 1, ai: 'normal', aiStyle: 'balanced', armyCount: 2, armySides: [1, 2, 3, 4], status: 'in-game', players: [] },
    };
    const lockstep = new LockstepRuntime({ sim, hf, economies: { 1: economy1, 2: economy2 }, client, session });
    expect(lockstep.issue({ type: 'move', ids: [tank.id], x: 62, z: 58, attackMove: false })).toBe(true);
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 8; i++) {
      sim.tick++;
      lockstep.tick();
    }
    expect(tank.mover?.target).toEqual({ x: 62, z: 58 });
  });

  it('applies tick-scheduled remote possession input, fire, and release to owned units only', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy1 = createEconomy(1);
    const economy2 = createEconomy(2);
    createInitialBase(sim, hf, economy1);
    createInitialBase(sim, hf, economy2);
    const hostTank = spawnTankAt(sim, 30, 30, 'Host Tank', 1);
    const guestTank = spawnTankAt(sim, 48, 30, 'Guest Tank', 2);
    let onEvent: ((event: unknown) => void) | undefined;
    const client = {
      connect: (_room: string, _playerId: string, handler: (event: unknown) => void) => {
        onEvent = handler;
      },
      disconnect: () => undefined,
      sendCommand: async () => undefined,
    } as unknown as MultiplayerClient;
    const session: MultiplayerSession = {
      player: { id: 'host', index: 1, name: 'Host', connected: true },
      room: { code: 'ABCD', seed: 1, ai: 'normal', aiStyle: 'balanced', armyCount: 2, armySides: [1, 2, 3, 4], status: 'in-game', players: [] },
    };
    const lockstep = new LockstepRuntime({ sim, hf, economies: { 1: economy1, 2: economy2 }, client, session });
    lockstep.connect();
    onEvent?.({
      type: 'command',
      playerId: 'guest',
      playerIndex: 2,
      tick: sim.tick,
      command: { type: 'possess-input', id: guestTank.id, throttle: 1, turn: -0.5, aimYaw: Math.PI / 2 },
    });
    onEvent?.({
      type: 'command',
      playerId: 'guest',
      playerIndex: 2,
      tick: sim.tick,
      command: { type: 'possess-input', id: hostTank.id, throttle: 1, turn: 1, aimYaw: 0 },
    });
    lockstep.tick();
    expect(guestTank.playerControlled).toMatchObject({ throttle: 1, turn: -0.5, aimYaw: Math.PI / 2 });
    expect(guestTank.transform.x).toBe(48);
    expect(hostTank.playerControlled).toBeUndefined();
    expect(hostTank.transform.x).toBe(30);

    onEvent?.({
      type: 'command',
      playerId: 'guest',
      playerIndex: 2,
      tick: sim.tick,
      command: { type: 'possess-fire', id: guestTank.id, slot: 'primary', x: hostTank.transform.x, z: hostTank.transform.z, aimYaw: Math.atan2(hostTank.transform.x - guestTank.transform.x, hostTank.transform.z - guestTank.transform.z) },
    });
    lockstep.tick();
    expect(guestTank.weapons?.primary.cooldown ?? guestTank.weapon?.cooldown ?? 0).toBeGreaterThan(0);

    onEvent?.({
      type: 'command',
      playerId: 'guest',
      playerIndex: 2,
      tick: sim.tick,
      command: { type: 'possess-release', id: guestTank.id },
    });
    lockstep.tick();
    expect(guestTank.playerControlled).toBeUndefined();
  });

  it('applies a remote unit upgrade to owned entities and charges that player economy', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy1 = createEconomy(1, 2000);
    const economy2 = createEconomy(2, 2000);
    const hostTank = spawnTankAt(sim, 30, 30, 'Host Tank', 1);
    const guestTank = spawnTankAt(sim, 48, 30, 'Guest Tank', 2);
    let onEvent: ((event: unknown) => void) | undefined;
    const client = {
      connect: (_room: string, _playerId: string, handler: (event: unknown) => void) => { onEvent = handler; },
      disconnect: () => undefined,
      sendCommand: async () => undefined,
    } as unknown as MultiplayerClient;
    const session: MultiplayerSession = {
      player: { id: 'host', index: 1, name: 'Host', connected: true },
      room: { code: 'ABCD', seed: 1, ai: 'normal', aiStyle: 'balanced', armyCount: 2, armySides: [1, 2, 3, 4], status: 'in-game', players: [] },
    };
    const lockstep = new LockstepRuntime({ sim, hf, economies: { 1: economy1, 2: economy2 }, client, session });
    lockstep.connect();
    onEvent?.({
      type: 'command', playerId: 'guest', playerIndex: 2, tick: sim.tick,
      command: { type: 'upgrade-units', ids: [guestTank.id, hostTank.id], upgradeId: 'ion-spear' },
    });
    lockstep.tick();
    expect(guestTank.specialWeapon?.kind).toBe('annihilatorMissile');
    expect(hostTank.specialWeapon).toBeUndefined();
    expect(economy2.credits).toBe(1440);
    expect(economy1.credits).toBe(2000);
  });

  it('host sends a recovery snapshot when a remote hash mismatches', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy1 = createEconomy(1);
    const economy2 = createEconomy(2);
    createInitialBase(sim, hf, economy1);
    createInitialBase(sim, hf, economy2);
    let onEvent: ((event: unknown) => void) | undefined;
    const sent: unknown[] = [];
    const client = {
      connect: (_room: string, _playerId: string, handler: (event: unknown) => void) => {
        onEvent = handler;
      },
      disconnect: () => undefined,
      sendCommand: async (_room: string, _playerId: string, _tick: number, command: unknown) => {
        sent.push(command);
      },
    } as unknown as MultiplayerClient;
    const lockstep = new LockstepRuntime({ sim, hf, economies: { 1: economy1, 2: economy2 }, client, session: sessionFor(1) });
    lockstep.connect();
    onEvent?.({
      type: 'command',
      playerId: 'guest',
      playerIndex: 2,
      tick: sim.tick,
      command: { type: 'sim-hash', hash: hashSim(sim) + 1 },
    });
    lockstep.tick();
    expect(sent.some((command) => isCommandType(command, 'match-snapshot'))).toBe(true);
  });

  it('pauses after a reconnect until the guest acknowledges the host snapshot', () => {
    const hf = generateHeightfield(MAP01);
    const match = testMatch(hf);
    let onEvent: ((event: unknown) => void) | undefined;
    const sent: unknown[] = [];
    const client = {
      connect: (_room: string, _playerId: string, handler: (event: unknown) => void) => {
        onEvent = handler;
      },
      disconnect: () => undefined,
      sendCommand: async (_room: string, _playerId: string, _tick: number, command: unknown) => {
        sent.push(command);
      },
    } as unknown as MultiplayerClient;
    const lockstep = new LockstepRuntime({
      sim: match.sim,
      hf,
      economies: { 1: match.economy1, 2: match.economy2 },
      client,
      session: sessionFor(1),
    });
    lockstep.connect();
    onEvent?.({
      type: 'room-state',
      room: { ...sessionFor(1).room, players: [{ id: 'host', index: 1, connected: true }, { id: 'guest', index: 2, connected: false }] },
    });
    expect(lockstep.canAdvance()).toBe(false);
    onEvent?.({
      type: 'room-state',
      room: { ...sessionFor(1).room, players: [{ id: 'host', index: 1, connected: true }, { id: 'guest', index: 2, connected: true }] },
    });
    expect(sent.some((command) => isCommandType(command, 'match-snapshot'))).toBe(true);
    expect(lockstep.canAdvance()).toBe(false);
    onEvent?.({
      type: 'command',
      playerId: 'guest',
      playerIndex: 2,
      tick: match.sim.tick,
      command: { type: 'snapshot-applied', hash: hashSim(match.sim), tick: match.sim.tick },
    });
    expect(lockstep.canAdvance()).toBe(true);
  });

  it('guest restores a host snapshot and resumes after desync recovery', () => {
    const hf = generateHeightfield(MAP01);
    const host = testMatch(hf);
    const guest = testMatch(hf);
    const guestTank = spawnTankAt(guest.sim, 42, 42, 'Guest Tank', 2);
    guestTank.transform.x += 9;
    expect(hashSim(guest.sim)).not.toBe(hashSim(host.sim));

    let onEvent: ((event: unknown) => void) | undefined;
    let restored = 0;
    const client = {
      connect: (_room: string, _playerId: string, handler: (event: unknown) => void) => {
        onEvent = handler;
      },
      disconnect: () => undefined,
      sendCommand: async () => undefined,
    } as unknown as MultiplayerClient;
    const lockstep = new LockstepRuntime({
      sim: guest.sim,
      hf,
      economies: { 1: guest.economy1, 2: guest.economy2 },
      client,
      session: sessionFor(2),
      onSnapshotRestored: () => {
        restored++;
      },
    });
    lockstep.connect();
    const snapshot = serializeMatchState(host.sim, [host.economy1, host.economy2]);
    onEvent?.({
      type: 'command',
      playerId: 'host',
      playerIndex: 1,
      tick: host.sim.tick,
      command: { type: 'match-snapshot', state: snapshot, hash: hashSim(host.sim), tick: host.sim.tick },
    });
    expect(restored).toBe(1);
    expect(hashSim(guest.sim)).toBe(hashSim(host.sim));
    expect(lockstep.canAdvance()).toBe(true);
  });

  it('pauses the match and reports victory when an opponent forfeits', () => {
    const hf = generateHeightfield(MAP01);
    const match = testMatch(hf);
    let onEvent: ((event: unknown) => void) | undefined;
    let status = '';
    const client = {
      connect: (_room: string, _playerId: string, handler: (event: unknown) => void) => {
        onEvent = handler;
      },
      disconnect: () => undefined,
      sendCommand: async () => undefined,
    } as unknown as MultiplayerClient;
    const lockstep = new LockstepRuntime({
      sim: match.sim,
      hf,
      economies: { 1: match.economy1, 2: match.economy2 },
      client,
      session: sessionFor(1),
      onStatus: (message) => {
        status = message;
      },
    });
    lockstep.connect();
    onEvent?.({ type: 'player-forfeit', playerId: 'guest', playerIndex: 2, name: 'Guest' });
    expect(lockstep.canAdvance()).toBe(false);
    expect(status).toBe('Guest forfeited — victory');
  });
});

function sessionFor(index: 1 | 2): MultiplayerSession {
  return {
    player: { id: index === 1 ? 'host' : 'guest', index, name: index === 1 ? 'Host' : 'Guest', connected: true },
    room: { code: 'ABCD', seed: 1, ai: 'normal', aiStyle: 'balanced', armyCount: 2, armySides: [1, 2, 3, 4], status: 'in-game', players: [] },
  };
}

function testMatch(hf: ReturnType<typeof generateHeightfield>): { sim: GameSim; economy1: ReturnType<typeof createEconomy>; economy2: ReturnType<typeof createEconomy> } {
  const sim = createGameSim(hf);
  const economy1 = createEconomy(1);
  const economy2 = createEconomy(2);
  createInitialBase(sim, hf, economy1);
  createInitialBase(sim, hf, economy2);
  return { sim, economy1, economy2 };
}

function isCommandType(command: unknown, type: string): boolean {
  return !!command && typeof command === 'object' && (command as { type?: unknown }).type === type;
}
