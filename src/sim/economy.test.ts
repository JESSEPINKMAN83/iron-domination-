import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { STRUCTURES } from '../content/phase3';
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

  it('previews and places missing wall segments between two wall anchors', () => {
    const hf = generateHeightfield(MAP01);
    hf.walkable.fill(1);
    const grid = hf.cellSize * 2;
    let run:
      | {
          sim: ReturnType<typeof createGameSim>;
          economy: ReturnType<typeof createEconomy>;
          anchor: NonNullable<ReturnType<typeof placeStructure>>;
          placement: ReturnType<typeof updatePlacement>;
      }
      | undefined;

    for (let z = -grid * 6; z <= grid * 6; z += grid * 3) {
      for (let x = -grid * 6; x <= grid * 6; x += grid * 3) {
        const sim = createGameSim(hf);
        const economy = createEconomy(1, 2200);
        economy.readyStructure = 'wall';
        const anchorPlacement = { kind: 'wall' as const, x: Math.round(x / grid) * grid, z: Math.round(z / grid) * grid, valid: true, reason: '' };
        const anchor = placeStructure(sim, hf, economy, anchorPlacement);
        if (!anchor) continue;
        economy.readyStructure = 'wall';
        for (const direction of [
          { x: 1, z: 0 },
          { x: -1, z: 0 },
          { x: 0, z: 1 },
          { x: 0, z: -1 },
        ]) {
          const placement = updatePlacement(sim, hf, 'wall', anchor.transform.x + grid * 2 * direction.x, anchor.transform.z + grid * 2 * direction.z, economy.team, economy);
          if (placement.valid && (placement.wallLine?.length ?? 0) === 2) {
            run = { sim, economy, anchor, placement };
            break;
          }
        }
        if (run) break;
      }
      if (run) break;
    }

    expect(run).toBeDefined();
    const { sim, economy, anchor, placement } = run!;
    const beforeCredits = economy.credits;
    expect(placement.extraCost).toBe((placement.wallLine!.length - 1) * STRUCTURES.wall.cost);
    expect(placeStructure(sim, hf, economy, placement)).toBeDefined();
    expect(economy.credits).toBe(beforeCredits - placement.extraCost!);

    const walls = buildings(sim, economy.team).filter((entity) => entity.building?.kind === 'wall');
    expect(walls).toHaveLength(3);
    const dx = Math.sign(placement.wallLine![0].x - anchor.transform.x);
    const dz = Math.sign(placement.wallLine![0].z - anchor.transform.z);
    for (let i = 0; i <= 2; i++) {
      expect(walls.some((wall) => Math.hypot(wall.transform.x - (anchor.transform.x + grid * dx * i), wall.transform.z - (anchor.transform.z + grid * dz * i)) < 0.1)).toBe(true);
    }
  });

  it('extends wall chains only from open wall ends, not side segments', () => {
    const hf = generateHeightfield(MAP01);
    hf.walkable.fill(1);
    const grid = hf.cellSize * 2;
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 2200);
    const placeWall = (x: number, z: number) => {
      economy.readyStructure = 'wall';
      const wall = placeStructure(sim, hf, economy, { kind: 'wall', x, z, valid: true, reason: '' });
      expect(wall).toBeDefined();
      return wall!;
    };

    placeWall(0, 0);
    placeWall(0, grid);
    placeWall(0, grid * 2);
    placeWall(0, grid * 3);

    const placement = updatePlacement(sim, hf, 'wall', -grid * 2, grid * 2, economy.team, economy);

    expect(placement.valid, placement.reason).toBe(true);
    expect(placement.wallLine).toEqual([
      { x: -grid, z: grid },
      { x: -grid * 2, z: grid * 2 },
    ]);
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
