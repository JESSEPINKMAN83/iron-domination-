import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { createEconomy, createInitialBase } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim, spawnTankAt } from '../sim/world';
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

  it('applies realtime remote possession control, fire, and release to owned units only', () => {
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
      command: { type: 'possess-control', id: guestTank.id, throttle: 1, turn: -0.5, aimYaw: Math.PI / 2, x: 52, z: 31, rot: Math.PI / 3, vx: 3, vz: 1 },
    });
    onEvent?.({
      type: 'command',
      playerId: 'guest',
      playerIndex: 2,
      tick: sim.tick,
      command: { type: 'possess-control', id: hostTank.id, throttle: 1, turn: 1, aimYaw: 0, x: 90, z: 90, rot: 0 },
    });
    lockstep.tick();
    expect(guestTank.playerControlled).toMatchObject({ throttle: 1, turn: -0.5, aimYaw: Math.PI / 2 });
    expect(guestTank.transform.x).toBe(52);
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
});
