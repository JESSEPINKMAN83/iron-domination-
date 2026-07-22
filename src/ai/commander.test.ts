import { describe, expect, it, vi } from 'vitest';
import { MAP01 } from '../content/map01';
import { AI_DIFFICULTY } from '../content/phase6';
import { startPosition } from '../content/startPositions';
import { stepCombat } from '../sim/combat';
import { createEconomy, createInitialBase, buildings, placeStructure, stepEconomy, updatePlacement, type PlacementState } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { VisibilityGrid } from '../sim/visibility';
import { createGameSim, hashSim, spawnDebugTanks, spawnTankAt, stepSim, type GameSim } from '../sim/world';
import { EnemyCommander } from './commander';

const DT = 1 / 30;

function validPlacement(sim: GameSim, hf: ReturnType<typeof generateHeightfield>, kind: PlacementState['kind'], x: number, z: number, team: number): PlacementState {
  const direct = updatePlacement(sim, hf, kind, x, z, team);
  if (direct.valid) return direct;
  for (const radius of [24, 34, 46, 58, 72]) {
    for (let step = 0; step < 16; step++) {
      const angle = (step / 16) * Math.PI * 2;
      const placement = updatePlacement(sim, hf, kind, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, team);
      if (placement.valid) return placement;
    }
  }
  throw new Error(`no valid ${kind} placement near ${x},${z}`);
}

function runMatch(ticks: number) {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const playerEconomy = createEconomy(1);
  createInitialBase(sim, hf, playerEconomy);
  const enemyEconomy = createEconomy(2, 4600);
  const enemyStart = startPosition(hf.size, 2);
  createInitialBase(sim, hf, enemyEconomy, enemyStart.x, enemyStart.z);
  const aiVision = new VisibilityGrid(hf, 2);
  const commander = new EnemyCommander(sim, hf, enemyEconomy, aiVision, 'rusher', 'normal');
  spawnDebugTanks(sim, hf, 6);

  for (let i = 0; i < ticks; i++) {
    commander.step(DT);
    stepEconomy(sim, hf, playerEconomy, DT);
    stepEconomy(sim, hf, enemyEconomy, DT);
    stepSim(sim, hf, DT);
    stepCombat(sim, DT);
    aiVision.update(sim);
  }
  vi.restoreAllMocks();
  return { sim, commander, enemyEconomy };
}

describe('phase 6 enemy commander', () => {
  it('builds its base, produces an army, and launches attacks', () => {
    const { sim, commander } = runMatch(30 * 240); // 4 sim-minutes
    const aiBuildings = buildings(sim, 2).filter((entity) => entity.building?.complete);
    expect(aiBuildings.length).toBeGreaterThanOrEqual(4); // yard + power + refinery + factory
    expect(commander.stats.structuresPlaced).toBeGreaterThanOrEqual(3);
    const aiTanks = Array.from(sim.world.entities).filter(
      (entity) => entity.team?.id === 2 && entity.selectable?.type === 'tank' && !entity.destroyed,
    );
    expect(aiTanks.length).toBeGreaterThanOrEqual(4);
    expect(commander.stats.attacksLaunched).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic: same setup → identical sim hash', () => {
    const first = runMatch(30 * 60);
    const second = runMatch(30 * 60);
    expect(hashSim(first.sim)).toBe(hashSim(second.sim));
    expect(first.commander.stats).toEqual(second.commander.stats);
  });

  it('raids visible economy targets before ordinary buildings', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const playerEconomy = createEconomy(1);
    const playerBase = createInitialBase(sim, hf, playerEconomy);
    const refinerySpot = validPlacement(sim, hf, 'refinery', playerBase.transform.x + 42, playerBase.transform.z, 1);
    playerEconomy.readyStructure = 'refinery';
    const refinery = placeStructure(sim, hf, playerEconomy, refinerySpot);
    expect(refinery).toBeTruthy();
    const harvester = playerEconomy.pendingSpawned.find((entity) => entity.harvester);
    expect(harvester).toBeTruthy();

    const enemyEconomy = createEconomy(2);
    createInitialBase(sim, hf, enemyEconomy, playerBase.transform.x + 190, playerBase.transform.z + 20);
    const aiVision = new VisibilityGrid(hf, 2);
    const commander = new EnemyCommander(sim, hf, enemyEconomy, aiVision, 'rusher', 'normal');
    const raider = spawnTankAt(sim, harvester!.transform.x + 40, harvester!.transform.z + 12, 'Economy Raider', 2);
    raider.vision = { radius: 260 };
    aiVision.update(sim);

    const target = (commander as unknown as { pickTarget: (squad: { units: typeof raider[]; state: 'attacking'; nextOrderAt: number }) => { x: number; z: number } }).pickTarget({
      units: [raider],
      state: 'attacking',
      nextOrderAt: 0,
    });

    expect(Math.hypot(target.x - harvester!.transform.x, target.z - harvester!.transform.z)).toBeLessThan(1);
    vi.restoreAllMocks();
  });

  it('orders large tank squads into an attack-move standoff instead of the enemy center', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const playerEconomy = createEconomy(1);
    const playerBase = createInitialBase(sim, hf, playerEconomy, 0, -20);
    const enemyEconomy = createEconomy(2, 4600);
    createInitialBase(sim, hf, enemyEconomy, 180, 20);
    const tanks = Array.from({ length: 16 }, (_, index) => {
      const tank = spawnTankAt(sim, -72 + (index % 4) * 7, -36 + Math.floor(index / 4) * 7, `Assault ${index + 1}`, 2);
      tank.vision = { radius: 180 };
      return tank;
    });
    const aiVision = new VisibilityGrid(hf, 2);
    aiVision.update(sim);
    const commander = new EnemyCommander(sim, hf, enemyEconomy, aiVision, 'rusher', 'normal');
    const squad = { units: tanks, state: 'attacking' as const, nextOrderAt: 0 };
    (commander as unknown as { squads: typeof squad[] }).squads.push(squad);

    (commander as unknown as { commandSquads: () => void }).commandSquads();

    expect(tanks.every((tank) => tank.mover?.attackMove && tank.mover.attackTargetId === undefined)).toBe(true);
    const destinations = tanks.map((tank) => ({
      x: tank.mover!.target!.x + (tank.mover!.formationOffset?.x ?? 0),
      z: tank.mover!.target!.z + (tank.mover!.formationOffset?.z ?? 0),
    }));
    const averageDistance = destinations.reduce(
      (sum, point) => sum + Math.hypot(point.x - playerBase.transform.x, point.z - playerBase.transform.z),
      0,
    ) / destinations.length;
    expect(averageDistance).toBeGreaterThan((playerBase.collider?.radius ?? 0) + 10);
    expect(new Set(destinations.map((point) => `${point.x.toFixed(2)}:${point.z.toFixed(2)}`)).size).toBe(tanks.length);
    vi.restoreAllMocks();
  });

  it('places new refineries toward live resource nodes', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const enemyEconomy = createEconomy(2, 4600);
    const enemyBase = createInitialBase(sim, hf, enemyEconomy, -20, -20);
    sim.resourceNodes = [{ id: 99, kind: 'oil', x: enemyBase.transform.x + 72, z: enemyBase.transform.z + 4, radius: 14, capacity: 1000, remaining: 1000 }];
    const commander = new EnemyCommander(sim, hf, enemyEconomy, new VisibilityGrid(hf, 2), 'balanced', 'normal');

    const spot = (commander as unknown as { findPlacement: (kind: 'refinery') => PlacementState | undefined }).findPlacement('refinery');

    expect(spot?.valid).toBe(true);
    expect(Math.hypot((spot?.x ?? 0) - sim.resourceNodes[0].x, (spot?.z ?? 0) - sim.resourceNodes[0].z)).toBeLessThan(
      Math.hypot(enemyBase.transform.x - sim.resourceNodes[0].x, enemyBase.transform.z - sim.resourceNodes[0].z),
    );
    vi.restoreAllMocks();
  });

  it('applies easy-mode combat handicaps to enemy units', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const enemyEconomy = createEconomy(2, 2600);
    createInitialBase(sim, hf, enemyEconomy, 20, 20);
    const tank = spawnTankAt(sim, 30, 32, 'Easy Tank', 2);
    const commander = new EnemyCommander(sim, hf, enemyEconomy, new VisibilityGrid(hf, 2), 'balanced', 'easy');

    commander.step(DT);

    expect(tank.aiCombat).toMatchObject({
      accuracy: AI_DIFFICULTY.easy.combatAccuracy,
      cooldownMultiplier: AI_DIFFICULTY.easy.combatCooldownMultiplier,
      projectileScatter: AI_DIFFICULTY.easy.projectileScatter,
      targetAcquireDelayTicks: AI_DIFFICULTY.easy.targetAcquireDelayTicks,
      possessedTargetPriority: AI_DIFFICULTY.easy.possessedTargetPriority,
    });
    vi.restoreAllMocks();
  });
});
