import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import {
  buildings,
  canBuildStructure,
  canQueueUnit,
  cancelStructureBuild,
  cancelUnitQueue,
  createEconomy,
  createInitialBase,
  MAX_PRODUCER_JOBS,
  placeStructure,
  queueUnit,
  setProducerRally,
  startStructureBuild,
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
      expect(startStructureBuild(sim, economy, kind)).toBe(true);
      for (let i = 0; i < 30 * 10; i++) {
        stepEconomy(sim, hf, economy, 1 / 30);
        stepSim(sim, hf, 1 / 30);
      }
      expect(economy.readyStructure).toBe(kind);
      const placement = updatePlacement(sim, hf, kind, base.transform.x + dx, base.transform.z + z);
      expect(placement.valid, placement.reason).toBe(true);
      const entity = placeStructure(sim, hf, economy, placement);
      expect(entity).toBeDefined();
      expect(entity!.building?.complete).toBe(true);
      for (let i = 0; i < 30 * 2; i++) {
        stepEconomy(sim, hf, economy, 1 / 30);
        stepSim(sim, hf, 1 / 30);
      }
      expect(entity!.building?.buildProgress).toBe(1);
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

  it('lets repeated unit clicks stack a full ten-job producer queue', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 8000);
    const base = createInitialBase(sim, hf, economy);

    const buildReady = (kind: Parameters<typeof canBuildStructure>[2], dx: number, z: number) => {
      expect(startStructureBuild(sim, economy, kind)).toBe(true);
      for (let i = 0; i < 30 * 10; i++) stepEconomy(sim, hf, economy, 1 / 30);
      const placement = updatePlacement(sim, hf, kind, base.transform.x + dx, base.transform.z + z);
      const entity = placeStructure(sim, hf, economy, placement);
      expect(entity).toBeDefined();
      return entity!;
    };

    buildReady('power-plant', -28, 0);
    const barracks = buildReady('barracks', 0, 28);
    for (let i = 0; i < MAX_PRODUCER_JOBS; i++) expect(queueUnit(sim, economy, 'infantry', barracks)).toBe(true);
    expect(queueUnit(sim, economy, 'infantry', barracks)).toBe(false);
    expect(barracks.producer?.queue.length).toBe(MAX_PRODUCER_JOBS);
  });

  it('refunds structure and unit cancels, and sends produced units to a rally', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    expect(cancelStructureBuild(sim, economy)).toBe(true);
    expect(economy.credits).toBe(5200);

    const buildReady = (kind: Parameters<typeof canBuildStructure>[2], dx: number, z: number) => {
      expect(startStructureBuild(sim, economy, kind)).toBe(true);
      for (let i = 0; i < 30 * 10; i++) stepEconomy(sim, hf, economy, 1 / 30);
      const placement = updatePlacement(sim, hf, kind, base.transform.x + dx, base.transform.z + z);
      const entity = placeStructure(sim, hf, economy, placement);
      expect(entity).toBeDefined();
      return entity!;
    };

    buildReady('power-plant', -28, 0);
    buildReady('refinery', 28, 0);
    const factory = buildReady('factory', -70, 18);
    const rally = setProducerRally(sim, economy, factory, base.transform.x + 80, base.transform.z + 80);
    expect(rally).toBeDefined();

    expect(queueUnit(sim, economy, 'tank', factory)).toBe(true);
    expect(cancelUnitQueue(sim, economy, 'tank', factory)).toBe(true);
    expect(factory.producer?.queue.length).toBe(0);

    expect(queueUnit(sim, economy, 'tank', factory)).toBe(true);
    for (let i = 0; i < 30 * 12; i++) {
      stepEconomy(sim, hf, economy, 1 / 30);
      stepSim(sim, hf, 1 / 30);
    }
    const tank = Array.from(sim.world.entities).find((entity) => entity.selectable?.type === 'tank' && entity.team?.id === 1);
    expect(tank?.mover?.target).toEqual(rally);
  });
});
