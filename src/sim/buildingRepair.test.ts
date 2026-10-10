import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { createGameSim } from './world';
import { createEconomy, createInitialBase, startBuildingRepair, stepEconomy } from './economy';

function fixture(credits = 300) {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const economy = createEconomy(1, credits);
  const base = createInitialBase(sim, hf, economy, 0, 0);
  base.health!.current = 1;
  return { hf, sim, economy, base };
}
describe('building repairs', () => {
  it('repairs fully over twenty paid seconds and restores damage cells', () => {
    const { sim, hf, economy, base } = fixture();
    base.structureDamage!.cells.fill(100);
    expect(startBuildingRepair(sim, economy, base.id)).toBe(true);
    for (let i = 0; i < 600; i++) stepEconomy(sim, hf, economy, 1 / 30);
    expect(base.health!.current).toBe(base.health!.max);
    expect(economy.credits).toBeCloseTo(100);
    expect(base.building!.repair).toBeUndefined();
    expect([...base.structureDamage!.cells].every((value) => value === 0)).toBe(true);
  });
  it('pauses without funds and resumes without charging for missed seconds', () => {
    const { sim, hf, economy, base } = fixture(0);
    startBuildingRepair(sim, economy, base.id);
    stepEconomy(sim, hf, economy, 5);
    expect(base.health!.current).toBe(1);
    economy.credits = 10;
    stepEconomy(sim, hf, economy, 1);
    expect(base.health!.current).toBeCloseTo(1 + base.health!.max / 20);
    expect(economy.credits).toBe(0);
  });
  it('rejects enemy and intact buildings, and cancels after destruction', () => {
    const { sim, hf, economy, base } = fixture();
    expect(startBuildingRepair(sim, createEconomy(2, 100), base.id)).toBe(false);
    base.health!.current = base.health!.max;
    expect(startBuildingRepair(sim, economy, base.id)).toBe(false);
    base.health!.current = 10;
    startBuildingRepair(sim, economy, base.id);
    base.destroyed = { remaining: 10 };
    stepEconomy(sim, hf, economy, 1);
    expect(base.building!.repair).toBeUndefined();
    expect(economy.credits).toBe(300);
  });
});
