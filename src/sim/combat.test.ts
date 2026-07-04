import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { damageForArmor, stepCombat } from './combat';
import { generateHeightfield } from './heightfield';
import { createGameSim, hashSim, spawnTankAt } from './world';

describe('phase 4 combat simulation', () => {
  it('applies weapon damage matrix values', () => {
    expect(damageForArmor('rifle', 'heavy')).toBeCloseTo(2.2);
    expect(damageForArmor('cannon', 'heavy')).toBeCloseTo(28);
    expect(damageForArmor('cannon', 'building')).toBeCloseTo(17.36);
  });

  it('resolves a deterministic tank engagement and records combat events', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const a = spawnTankAt(sim, -20, -20, 'A');
      const b = spawnTankAt(sim, 18, -20, 'B', 2);
      for (let i = 0; i < 30 * 8; i++) stepCombat(sim, 1 / 30);
      return { sim, aHp: a.health?.current ?? 0, bHp: b.health?.current ?? 0, events: sim.events.length, hash: hashSim(sim) };
    };

    const first = run();
    const second = run();
    expect(first.hash).toBe(second.hash);
    expect(first.events).toBeGreaterThan(0);
    expect(first.aHp).toBeLessThan(100);
    expect(first.bHp).toBeLessThan(100);
  });
});
