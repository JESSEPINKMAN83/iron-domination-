import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { stepCombat } from './combat';
import { generateHeightfield } from './heightfield';
import { SpatialHash } from './spatialHash';
import { createGameSim, spawnTankAt, stepSim } from './world';

describe('large battle performance safeguards', () => {
  it('queries only nearby spatial buckets in stable order', () => {
    const grid = new SpatialHash<{ id: number; transform: { x: number; z: number } }>(20);
    grid.rebuild([
      { id: 1, transform: { x: -200, z: 0 } },
      { id: 2, transform: { x: 4, z: 3 } },
      { id: 3, transform: { x: 16, z: 7 } },
      { id: 4, transform: { x: 220, z: 0 } },
    ]);
    const visited: number[] = [];
    grid.visitNearby(0, 0, 24, (item) => visited.push(item.id));
    expect(visited).toEqual([2, 3]);
  });

  it('keeps a dense three-army simulation within a bounded soak budget', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.allianceSides = { 1: 1, 2: 2, 3: 3 };
    const units = [];
    for (let i = 0; i < 180; i++) {
      const col = i % 18;
      const row = Math.floor(i / 18);
      const tank = spawnTankAt(sim, -120 + col * 14, -70 + row * 14, `Soak ${i + 1}`, (i % 3) + 1);
      // Keep the whole force alive and acquiring/moving for the complete soak.
      tank.health!.current = tank.health!.max = 1_000_000;
      for (const weapon of [tank.weapons?.primary, tank.weapons?.secondary]) {
        if (weapon) weapon.cooldown = 10_000;
      }
      units.push(tank);
    }

    const started = performance.now();
    for (let tick = 0; tick < 450; tick++) {
      stepSim(sim, hf, 1 / 30);
      stepCombat(sim, 1 / 30);
      sim.events.length = 0;
    }
    const elapsed = performance.now() - started;

    expect(units.every((unit) => !unit.destroyed)).toBe(true);
    // Deliberately generous for shared CI runners; this catches accidental
    // restoration of all-vs-all hot loops without making ordinary variance fail.
    expect(elapsed).toBeLessThan(4_000);
  }, 15_000);
});
