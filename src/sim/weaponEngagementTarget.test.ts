import { describe, expect, it } from 'vitest';
import { generateHeightfield } from './heightfield';
import { createGameSim, spawnTankAt } from './world';
import { weaponEngagementTarget } from './combat';

describe('read-only weapon engagement feedback', () => {
  it('keeps out-of-range orders amber and recognizes valid engagements without changing weapon state', () => {
    const hf = generateHeightfield({ cells: 64, cellSize: 2, waterLevel: -100, seed: 41, oreFieldCount: 0 });
    hf.heights.fill(0); hf.walkable.fill(1);
    const sim = createGameSim(hf);
    const source = spawnTankAt(sim, -20, 0, 'Source', 1), target = spawnTankAt(sim, 20, 0, 'Target', 2);
    const weapon = source.weapon!; weapon.targetId = target.id; weapon.range = 10;
    expect(weaponEngagementTarget(sim, source, weapon)).toBeUndefined();
    expect(weapon.targetId).toBe(target.id);
    weapon.range = 100;
    expect(weaponEngagementTarget(sim, source, weapon)).toBe(target);
    const before = JSON.stringify(weapon);
    weaponEngagementTarget(sim, source, weapon);
    expect(JSON.stringify(weapon)).toBe(before);
    target.destroyed = { remaining: 10 };
    expect(weaponEngagementTarget(sim, source, weapon)).toBeUndefined();
  });
});
