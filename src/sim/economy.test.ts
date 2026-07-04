import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { STRUCTURES, UNITS, type UnitKind } from '../content/phase3';
import { manualFireAt } from './combat';
import { generateHeightfield } from './heightfield';
import {
  buildings,
  canBuildStructure,
  canQueueUnit,
  cancelStructureBuild,
  cancelUnitQueue,
  createEconomy,
  createInitialBase,
  issueHarvesterReturnOrder,
  issueHarvestOrder,
  MAX_PRODUCER_JOBS,
  placeStructure,
  queueUnit,
  setProducerRally,
  startStructureBuild,
  stepEconomy,
  updatePlacement,
} from './economy';
import { createGameSim, spawnTankAt, stepSim } from './world';

describe('phase 3 economy and production', () => {
  it('does not create passive credits without a working collector loop', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 1200);
    createInitialBase(sim, hf, economy);

    for (let i = 0; i < 30 * 20; i++) {
      stepEconomy(sim, hf, economy, 1 / 30);
      stepSim(sim, hf, 1 / 30);
    }

    expect(economy.credits).toBe(1200);
    expect(economy.ledger.some((entry) => entry.type === 'income')).toBe(false);
  });

  it('spawns a refinery harvester that depletes ore and deposits credits', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 3000);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    const power = placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z, economy.team));
    expect(power).toBeDefined();

    expect(startStructureBuild(sim, economy, 'refinery')).toBe(true);
    for (let i = 0; i < 30 * 8; i++) stepEconomy(sim, hf, economy, 1 / 30);
    const refinery = placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'refinery', base.transform.x + 28, base.transform.z, economy.team));
    expect(refinery).toBeDefined();
    sim.resourceNodes = [
      {
        id: 999,
        kind: 'oil',
        x: refinery!.transform.x + 34,
        z: refinery!.transform.z + 10,
        radius: 10,
        capacity: 600,
        remaining: 600,
      },
    ];

    const spawned = stepEconomy(sim, hf, economy, 1 / 30);
    const harvester = spawned.find((entity) => entity.harvester);
    expect(harvester).toBeDefined();
    expect(harvester?.cargo?.capacity).toBeGreaterThan(0);

    const beforeCredits = economy.credits;
    const beforeOre = sim.resourceNodes.reduce((sum, node) => sum + node.remaining, 0);
    for (let i = 0; i < 30 * 35; i++) {
      stepEconomy(sim, hf, economy, 1 / 30);
      stepSim(sim, hf, 1 / 30);
    }

    const afterOre = sim.resourceNodes.reduce((sum, node) => sum + node.remaining, 0);
    expect(afterOre).toBeLessThan(beforeOre);
    expect(economy.credits).toBeGreaterThan(beforeCredits);
    expect(economy.ledger.some((entry) => entry.type === 'income' && entry.label === 'Ore delivered' && entry.amount > 0)).toBe(true);
  });

  it('lets selected harvesters be manually ordered back to an ore field or refinery', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 3000);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    expect(placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z, economy.team))).toBeDefined();

    expect(startStructureBuild(sim, economy, 'refinery')).toBe(true);
    for (let i = 0; i < 30 * 8; i++) stepEconomy(sim, hf, economy, 1 / 30);
    const refinery = placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'refinery', base.transform.x + 28, base.transform.z, economy.team));
    expect(refinery).toBeDefined();
    sim.resourceNodes = [{ id: 77, kind: 'oil', x: refinery!.transform.x + 42, z: refinery!.transform.z + 8, radius: 12, capacity: 500, remaining: 500 }];

    const harvester = stepEconomy(sim, hf, economy, 1 / 30).find((entity) => entity.harvester);
    expect(harvester).toBeDefined();
    harvester!.harvester!.state = 'seeking';
    harvester!.harvester!.nodeId = undefined;
    harvester!.mover!.target = undefined;

    expect(issueHarvestOrder(sim, [harvester!], sim.resourceNodes[0].x + 2, sim.resourceNodes[0].z)).toBe(true);
    expect(harvester!.harvester?.state).toBe('to-node');
    expect(harvester!.harvester?.nodeId).toBe(77);
    expect(harvester!.mover?.target).toEqual({ x: sim.resourceNodes[0].x, z: sim.resourceNodes[0].z });
    harvester!.cargo!.amount = 150;
    expect(issueHarvestOrder(sim, [harvester!], refinery!.transform.x, refinery!.transform.z)).toBe(false);
    expect(issueHarvesterReturnOrder(sim, [harvester!], refinery!.transform.x, refinery!.transform.z)).toBe(true);
    expect(harvester!.harvester?.state).toBe('to-refinery');
    expect(harvester!.harvester?.refineryId).toBe(refinery!.id);
  });

  it('recalls a damaged harvester to its assigned refinery', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 3000);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    expect(placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z, economy.team))).toBeDefined();

    expect(startStructureBuild(sim, economy, 'refinery')).toBe(true);
    for (let i = 0; i < 30 * 8; i++) stepEconomy(sim, hf, economy, 1 / 30);
    const refinery = placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'refinery', base.transform.x + 28, base.transform.z, economy.team));
    expect(refinery).toBeDefined();
    sim.resourceNodes = [{ id: 88, kind: 'oil', x: refinery!.transform.x + 56, z: refinery!.transform.z, radius: 12, capacity: 500, remaining: 500 }];

    const harvester = stepEconomy(sim, hf, economy, 1 / 30).find((entity) => entity.harvester);
    expect(harvester).toBeDefined();
    expect(issueHarvestOrder(sim, [harvester!], sim.resourceNodes[0].x, sim.resourceNodes[0].z)).toBe(true);

    const attacker = spawnTankAt(sim, harvester!.transform.x + 44, harvester!.transform.z, 'Collector Raider', 2);
    const yaw = Math.atan2(harvester!.transform.x - attacker.transform.x, harvester!.transform.z - attacker.transform.z);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: yaw };
    attacker.turret!.yaw = yaw;
    expect(manualFireAt(sim, attacker, harvester!.transform.x, harvester!.transform.z)).toBe(true);

    stepEconomy(sim, hf, economy, 1 / 30);

    expect(harvester!.health!.current).toBeLessThan(harvester!.health!.max);
    expect(harvester!.harvester?.threatTimer).toBeGreaterThan(0);
    expect(harvester!.harvester?.state).toBe('to-refinery');
    expect(harvester!.mover?.target).toEqual({ x: refinery!.transform.x, z: refinery!.transform.z });
  });

  it('replaces a lost refinery harvester after a delay', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 3000);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    expect(placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z, economy.team))).toBeDefined();

    expect(startStructureBuild(sim, economy, 'refinery')).toBe(true);
    for (let i = 0; i < 30 * 8; i++) stepEconomy(sim, hf, economy, 1 / 30);
    const refinery = placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'refinery', base.transform.x + 28, base.transform.z, economy.team));
    expect(refinery).toBeDefined();

    const first = stepEconomy(sim, hf, economy, 1 / 30).find((entity) => entity.harvester);
    expect(first).toBeDefined();
    first!.destroyed = { remaining: 20 };

    let replacement;
    for (let i = 0; i < 30 * 20; i++) {
      const spawned = stepEconomy(sim, hf, economy, 1 / 30);
      replacement = spawned.find((entity) => entity.harvester && entity !== first);
      if (replacement) break;
    }

    expect(replacement).toBeDefined();
    expect(replacement!.harvester?.refineryId).toBe(refinery!.id);
  });

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

  it('produces the expanded infantry, vehicle, and aircraft roster with distinct weapons', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 18000);
    const base = createInitialBase(sim, hf, economy);

    const buildReady = (kind: Parameters<typeof canBuildStructure>[2], dx: number, z: number) => {
      expect(startStructureBuild(sim, economy, kind)).toBe(true);
      for (let i = 0; i < 30 * 10; i++) stepEconomy(sim, hf, economy, 1 / 30);
      const placement = updatePlacement(sim, hf, kind, base.transform.x + dx, base.transform.z + z);
      expect(placement.valid, placement.reason).toBe(true);
      const entity = placeStructure(sim, hf, economy, placement);
      expect(entity).toBeDefined();
      return entity!;
    };

    buildReady('power-plant', -28, 0);
    buildReady('refinery', 28, 0);
    const barracks = buildReady('barracks', 0, 28);
    const factory = buildReady('factory', 60, 20);
    const helipad = buildReady('helipad', 82, -28);

    for (const kind of Object.keys(UNITS) as UnitKind[]) {
      expect(canQueueUnit(sim, economy, kind).ok).toBe(true);
      const producer = UNITS[kind].producer === 'infantry' ? barracks : UNITS[kind].producer === 'vehicles' ? factory : helipad;
      expect(queueUnit(sim, economy, kind, producer)).toBe(true);
    }
    for (let i = 0; i < 30 * 55; i++) {
      stepEconomy(sim, hf, economy, 1 / 30);
      stepSim(sim, hf, 1 / 30);
    }

    const units = Array.from(sim.world.entities).filter((entity) => entity.mover && !entity.building);
    expect(units.some((entity) => entity.name === 'Rifle Team' && entity.weapon?.kind === 'rifle')).toBe(true);
    expect(units.some((entity) => entity.name === 'Grenadier' && entity.weapon?.kind === 'grenade')).toBe(true);
    expect(units.some((entity) => entity.name === 'Rocket Team' && entity.weapon?.kind === 'rocketLauncher')).toBe(true);
    expect(units.some((entity) => entity.name?.includes('Jackal') && entity.weapon?.kind === 'autocannon' && entity.weapons?.secondary?.salvoCount === 1)).toBe(true);
    expect(units.some((entity) => entity.name?.includes('M-17') && entity.weapon?.kind === 'cannon' && entity.weapons?.secondary?.salvoCount === 2)).toBe(true);
    expect(units.some((entity) => entity.name?.includes('Mauler') && entity.weapon?.kind === 'heavyCannon' && entity.weapons?.secondary?.salvoCount === 4)).toBe(true);
    expect(units.some((entity) => entity.name?.includes('Wasp') && entity.flight && entity.weapon?.kind === 'waspAutocannon' && entity.weapons?.secondary?.salvoCount === 1)).toBe(true);
    expect(units.some((entity) => entity.name?.includes('Vulture') && entity.flight && entity.weapon?.kind === 'rocketPod' && entity.weapons?.secondary?.salvoCount === 2)).toBe(true);
    expect(units.some((entity) => entity.name?.includes('Hammerhead') && entity.flight && entity.health?.max === 230 && entity.weapons?.secondary?.salvoCount === 4)).toBe(true);
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

  it('moves newly produced units clear of the producer when no rally is set', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
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
    buildReady('refinery', 28, 0);
    const factory = buildReady('factory', -70, 18);

    expect(queueUnit(sim, economy, 'tank', factory)).toBe(true);
    for (let i = 0; i < 30 * 10; i++) {
      stepEconomy(sim, hf, economy, 1 / 30);
      stepSim(sim, hf, 1 / 30);
    }

    const tank = Array.from(sim.world.entities).find((entity) => entity.selectable?.type === 'tank' && entity.team?.id === 1 && entity.name?.includes('M-17'));
    expect(tank).toBeDefined();
    const distFromFactory = Math.hypot(tank!.transform.x - factory.transform.x, tank!.transform.z - factory.transform.z);
    expect(distFromFactory).toBeGreaterThan(Math.max(factory.building!.footprint.w, factory.building!.footprint.h) * hf.cellSize);
    expect(tank!.mover?.target).toBeDefined();
  });
});
