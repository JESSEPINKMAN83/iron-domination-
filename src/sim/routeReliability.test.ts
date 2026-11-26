import { describe, expect, it } from 'vitest';
import { generateHeightfield } from './heightfield';
import { createGameSim, hashSim, issueMoveOrder, spawnTankAt, stepSim } from './world';
import { issueTacticOrder } from './tactics';

function arena() {
  const hf = generateHeightfield({ cells: 96, cellSize: 2, waterLevel: -100, seed: 41, oreFieldCount: 0 });
  hf.heights.fill(0); hf.walkable.fill(1);
  return { hf, sim: createGameSim(hf) };
}

describe('route and formation arrival', () => {
  it('parks all 36 tanks in a wide formation instead of circling the shared anchor', () => {
    const run = () => {
      const { hf, sim } = arena();
      const units = Array.from({ length: 36 }, (_, i) => spawnTankAt(sim, -75 + i % 6 * 8, -75 + Math.floor(i / 6) * 8, 'Formation', 1));
      issueMoveOrder(sim, units, 35, 35);
      for (let i = 0; i < 2400; i++) stepSim(sim, hf, 1 / 30);
      expect(units.filter(e => e.mover?.target)).toHaveLength(0);
      return hashSim(sim);
    };
    expect(run()).toBe(run());
  });
  it('routes a stranded formation slot around a newly placed blocker without abandoning the order', () => {
    const { hf, sim } = arena();
    const unit = spawnTankAt(sim, -30, 0, 'Slot', 1);
    issueMoveOrder(sim, [unit], 0, 0);
    unit.mover!.formationOffset = { x: 24, z: 0 };
    sim.nav.setBuildingBlocker(900, 11, 0, 2, 12);
    for (let i = 0; i < 1500; i++) {
      stepSim(sim, hf, 1 / 30);
      const cell = sim.nav.worldToCell(unit.transform.x, unit.transform.z);
      expect(sim.nav.isWalkableCell(cell.x, cell.y)).toBe(true);
    }
    expect(unit.mover!.target).toBeUndefined();
    expect(Math.hypot(unit.transform.x - 24, unit.transform.z)).toBeLessThan(3);
  });
  it.each(['hold', 'attack-move', 'attack-through'] as const)('keeps momentum through intermediate %s route points', endAction => {
    const { hf, sim } = arena();
    const unit = spawnTankAt(sim, -40, 0, 'Route', 1);
    issueTacticOrder(sim, [unit], [{ x: -20, z: 0 }, { x: 0, z: 0 }, { x: 25, z: 0 }], { kind: endAction });
    let transitions = 0;
    for (let i = 0; i < 900; i++) {
      const remaining = unit.mover?.tactic?.remaining.length ?? 0;
      stepSim(sim, hf, 1 / 30);
      if (remaining > 0 && (unit.mover?.tactic?.remaining.length ?? 0) < remaining) {
        transitions++;
        expect(Math.hypot(unit.velocity!.x, unit.velocity!.z)).toBeGreaterThan(1);
      }
    }
    expect(transitions).toBe(2);
    expect(unit.mover!.target).toBeUndefined();
  });
});
