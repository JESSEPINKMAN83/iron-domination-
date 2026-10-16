import { STRUCTURES } from '../content/phase3';
import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { createGameSim } from './world';
import { createEconomy, placeStructure } from './economy';

describe('long fence placement', () => {
  it('updates navigation once for a whole line while keeping every segment solid', () => {
    const hf = generateHeightfield({ ...MAP01, cells: 128 });
    hf.walkable.fill(1); hf.heights.fill(10);
    const sim = createGameSim(hf), economy = createEconomy(1, 100000);
    const points = Array.from({ length: 100 }, (_, i) => ({ x: -200 + i * 4, z: 0 }));
    economy.readyDefenseStructure = 'wall';
    const revision = sim.nav.revision;
    placeStructure(sim, hf, economy, { kind: 'wall', ...points[0], valid: true, reason: '', wallLine: points, extraCost: 99 * STRUCTURES.wall.cost });
    expect(sim.nav.revision - revision).toBe(1);
    expect([...sim.buildingsQuery]).toHaveLength(100);
    for (const point of points) {
      const cell = sim.nav.worldToCell(point.x, point.z);
      expect(sim.nav.isWalkableCell(cell.x, cell.y)).toBe(false);
    }
  });

  it('flushes nested batched blockers even if a change throws', () => {
    const hf = generateHeightfield({ ...MAP01, cells: 64 });
    hf.walkable.fill(1);
    const sim = createGameSim(hf), revision = sim.nav.revision;
    expect(() => sim.nav.batchBlockers(() => {
      sim.nav.setDynamicBlocker(1, 0, 0, 4);
      sim.nav.batchBlockers(() => sim.nav.setBuildingBlocker(2, 20, 0, 4, 4));
      throw new Error('abort');
    })).toThrow('abort');
    expect(sim.nav.revision - revision).toBe(1);
    expect(sim.nav.snapshotDynamicBlockers()).toHaveLength(2);
  });
});
