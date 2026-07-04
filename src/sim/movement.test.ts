import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { FlowField } from './flowfield';
import { generateHeightfield, sampleHeight } from './heightfield';
import { createGameSim, hashSim, issueMoveOrder, spawnDebugTanks, spawnVultureAt, stepSim } from './world';

describe('phase 2 movement simulation', () => {
  it('builds a flow field between distant walkable cells', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const start = sim.nav.nearestWalkableCell(-hf.size * 0.33, -hf.size * 0.28);
    const end = sim.nav.nearestWalkableCell(hf.size * 0.34, hf.size * 0.26);
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    const target = sim.nav.cellCenter(end!.x, end!.y);
    const flow = new FlowField(sim.nav, target.x, target.z);
    const origin = sim.nav.cellCenter(start!.x, start!.y);
    const dir = flow.directionAt(origin.x, origin.z);
    expect(dir.distance).toBeGreaterThan(0);
    expect(Math.hypot(dir.x, dir.z)).toBeGreaterThan(0.5);
  });

  it('moves 120 tanks deterministically for 10k ticks', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const tanks = spawnDebugTanks(sim, hf, 120);
      const target = sim.nav.nearestWalkableCell(hf.size * 0.34, hf.size * 0.26);
      expect(target).toBeDefined();
      const p = sim.nav.cellCenter(target!.x, target!.y);
      issueMoveOrder(sim, tanks, p.x, p.z);
      for (let i = 0; i < 10000; i++) stepSim(sim, hf, 1 / 30);
      return { sim, tanks, hash: hashSim(sim) };
    };

    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    const reached = a.tanks.filter((tank) => {
      if (!tank.mover?.target) return true;
      const dx = tank.transform.x - tank.mover.target.x;
      const dz = tank.transform.z - tank.mover.target.z;
      return Math.hypot(dx, dz) < 55;
    }).length;
    expect(reached).toBeGreaterThan(100);
  });

  it('moves a player-controlled tank through the same sim step', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const [tank] = spawnDebugTanks(sim, hf, 1);
    const start = { x: tank.transform.x, z: tank.transform.z };
    tank.playerControlled = { throttle: 1, turn: 0, aimYaw: tank.transform.rot };

    for (let i = 0; i < 90; i++) stepSim(sim, hf, 1 / 30);

    expect(Math.hypot(tank.transform.x - start.x, tank.transform.z - start.z)).toBeGreaterThan(8);
    expect(tank.mover?.target).toBeUndefined();
    expect(tank.mover?.flow).toBeUndefined();
  });

  it('moves flyers directly over blocked terrain while maintaining altitude', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -hf.size * 0.3, -hf.size * 0.2, 'Vulture 1');
    const start = { x: vulture.transform.x, z: vulture.transform.z };
    issueMoveOrder(sim, [vulture], hf.size * 0.3, hf.size * 0.22);

    for (let i = 0; i < 30 * 8; i++) stepSim(sim, hf, 1 / 30);

    expect(Math.hypot(vulture.transform.x - start.x, vulture.transform.z - start.z)).toBeGreaterThan(120);
    expect(vulture.mover?.flow).toBeUndefined();
    expect((vulture.transform.y ?? 0) - sampleHeight(hf, vulture.transform.x, vulture.transform.z)).toBeGreaterThanOrEqual(vulture.flight!.minAGL - 0.1);
  });
});
