import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import {
  buildings,
  canBuildStructure,
  canQueueUnit,
  createEconomy,
  createInitialBase,
  placeStructure,
  queueUnit,
  stepEconomy,
  updatePlacement,
} from './economy';
import { createGameSim, stepSim } from './world';

describe('phase 3 economy and production', () => {
  it('runs build order and parallel factory production with a matching ledger', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    const build = (kind: Parameters<typeof canBuildStructure>[2], dx: number, z: number) => {
      const check = canBuildStructure(sim, economy, kind);
      expect(check.ok).toBe(true);
      const placement = updatePlacement(sim, hf, kind, base.transform.x + dx, base.transform.z + z);
      expect(placement.valid, placement.reason).toBe(true);
      const entity = placeStructure(sim, hf, economy, placement);
      expect(entity).toBeDefined();
      for (let i = 0; i < 30 * 10; i++) {
        stepEconomy(sim, hf, economy, 1 / 30);
        stepSim(sim, hf, 1 / 30);
      }
      expect(entity!.building?.complete).toBe(true);
      return entity!;
    };

    build('power-plant', -28, 0);
    build('refinery', 28, 0);
    build('barracks', 0, 28);
    const f1 = build('factory', -80, 20);
    const f2 = build('factory', 60, 20);
    expect(f1.producer).toBeDefined();
    expect(f2.producer).toBeDefined();
    expect(economy.powerProduced).toBe(60);
    expect(economy.powerUsed).toBe(56);

    const beforeUnits = sim.world.entities.length;
    expect(canQueueUnit(sim, economy, 'tank').ok).toBe(true);
    expect(queueUnit(sim, economy, 'tank')).toBe(true);
    expect(queueUnit(sim, economy, 'tank')).toBe(true);
    expect(f1.producer?.active ?? f1.producer?.queue.length).toBeTruthy();
    expect(f2.producer?.active ?? f2.producer?.queue.length).toBeTruthy();

    for (let i = 0; i < 30 * 10; i++) {
      stepEconomy(sim, hf, economy, 1 / 30);
      stepSim(sim, hf, 1 / 30);
    }

    const afterUnits = sim.world.entities.length;
    expect(afterUnits - beforeUnits).toBe(2);
    expect(economy.ledger.some((entry) => entry.type === 'income' && entry.amount > 0)).toBe(true);
    const ledgerTotal = economy.ledger.reduce((sum, entry) => sum + entry.amount, 0);
    expect(economy.credits).toBe(5200 + ledgerTotal);
  });
});
