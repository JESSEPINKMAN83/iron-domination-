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
  function hardAssaultFixture(doctrine: 'iron-legion' | 'missile-command' = 'iron-legion') {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(2, 4600, doctrine);
    createInitialBase(sim, hf, economy, -180, 0);
    const vision = new VisibilityGrid(hf, 2);
    const commander = new EnemyCommander(sim, hf, economy, vision, 'rusher', 'hard', [{ x: 170, z: 0 }]);
    const units = Array.from({ length: 12 }, (_, i) => spawnTankAt(sim, -130 + i % 4 * 8, -12 + Math.floor(i / 4) * 8, `Raider ${i}`, 2));
    const control = commander as unknown as {
      elapsed: number;
      commandSquads: () => void;
      squads: Array<{ units: typeof units; state: string; nextOrderAt: number; maneuver?: string; flankUntil?: number }>;
    };
    control.elapsed = 180;
    return { hf, sim, economy, vision, commander, units, control };
  }

  it.each(['iron-legion', 'missile-command'] as const)('launches varied ground waves on Hard for %s', (doctrine) => {
    const { commander, control } = hardAssaultFixture(doctrine);
    for (let i = 0; i < 3; i++) control.commandSquads();
    expect(commander.stats.attacksLaunched).toBe(3);
    expect(control.squads.map((squad) => squad.maneuver)).toEqual(['direct', 'left', 'right']);
    const left = control.squads[1].units[0];
    const right = control.squads[2].units[0];
    expect(left.mover?.tactic?.endAction.kind).toBe('attack-through');
    expect(right.mover?.tactic?.endAction.kind).toBe('attack-through');
    expect(left.mover!.target!.z).toBeLessThan(0);
    expect(right.mover!.target!.z).toBeGreaterThan(0);
  });

  it('launches a balanced missile-faction ground expedition by three minutes when units are ready', () => {
    const { hf, sim, economy, vision } = hardAssaultFixture('missile-command');
    const commander = new EnemyCommander(sim, hf, economy, vision, 'balanced', 'hard', [{ x: 170, z: 0 }]);
    const control = commander as unknown as { elapsed: number; commandSquads: () => void; buildQueue: string[] };
    control.elapsed = 180;
    control.commandSquads();
    expect(commander.stats.attacksLaunched).toBe(1);
    expect(control.buildQueue.indexOf('barracks')).toBeLessThan(control.buildQueue.indexOf('strategic-silo'));
  });

  it('funds initial hard-mode ground units and infantry while expensive infrastructure is pending', () => {
    const { hf, sim, economy, commander } = hardAssaultFixture('missile-command');
    // Replace the ready army with an empty production pool.
    for (const unit of Array.from(sim.world.entities)) if (unit.mover && !unit.harvester) sim.world.remove(unit);
    const base = buildings(sim, economy.team)[0];
    for (const kind of ['power-plant', 'refinery', 'factory', 'barracks'] as const) {
      const spot = validPlacement(sim, hf, kind, base.transform.x + 40, base.transform.z + 40, economy.team);
      economy.readyStructure = kind;
      expect(placeStructure(sim, hf, economy, spot)).toBeTruthy();
    }
    economy.credits = 1400;
    (commander as unknown as { maintainProduction: () => void }).maintainProduction();
    const queued = buildings(sim, economy.team).flatMap((b) => b.producer?.queue.map((job) => job.kind) ?? []);
    expect(queued).toContain('scout-tank');
    expect(queued).toContain('infantry');
  });

  it('builds and sends missile-faction ground forces into the field in a real Hard opening', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const player = createEconomy(1);
    createInitialBase(sim, hf, player, -170, 0);
    const economy = createEconomy(2, AI_DIFFICULTY.hard.startCredits, 'missile-command');
    const base = createInitialBase(sim, hf, economy, 170, 0);
    const vision = new VisibilityGrid(hf, 2);
    const commander = new EnemyCommander(sim, hf, economy, vision, 'balanced', 'hard', [{ x: -170, z: 0 }]);
    let fieldForceSeen = false;
    for (let i = 0; i < 30 * 300; i++) {
      commander.step(DT);
      stepEconomy(sim, hf, economy, DT);
      stepSim(sim, hf, DT);
      stepCombat(sim, DT);
      vision.update(sim);
      if (i % 30 === 0) fieldForceSeen ||= Array.from(sim.world.entities).some((unit) =>
        unit.team?.id === 2 && unit.mover && !unit.harvester && !unit.destroyed &&
        Math.hypot(unit.transform.x - base.transform.x, unit.transform.z - base.transform.z) > 100,
      );
    }
    expect(commander.stats.attacksLaunched).toBeGreaterThanOrEqual(1);
    expect(fieldForceSeen).toBe(true);
    vi.restoreAllMocks();
  }, 30000);

  it('does not restart flank routes on every command pulse and falls back when a route expires', () => {
    const { sim, control } = hardAssaultFixture();
    control.commandSquads();
    control.commandSquads();
    const squad = control.squads[1];
    const unit = squad.units[0];
    const original = unit.mover?.tactic;
    sim.tick += 150;
    control.commandSquads();
    expect(unit.mover?.tactic).toBe(original);
    sim.tick = squad.flankUntil! + 150;
    control.commandSquads();
    expect(unit.mover?.tactic).toBeUndefined();
    expect(unit.mover?.attackMove).toBe(true);
    expect(squad.maneuver).toBe('direct');
  });

  it('interrupts a flank to retreat when its force is badly damaged', () => {
    const { sim, control, commander } = hardAssaultFixture();
    control.commandSquads();
    control.commandSquads();
    const squad = control.squads[1];
    for (const unit of squad.units) unit.health!.current = unit.health!.max * 0.2;
    sim.tick += 150;
    control.commandSquads();
    expect(squad.state).toBe('retreating');
    expect(squad.flankUntil).toBeUndefined();
    expect(squad.units.every((unit) => !unit.mover?.tactic && !unit.mover?.attackThrough)).toBe(true);
    expect(commander.stats.retreats).toBe(1);
  });

  it('keeps hard-mode maneuvers deterministic', () => {
    const first = hardAssaultFixture();
    const second = hardAssaultFixture();
    for (let i = 0; i < 3; i++) { first.control.commandSquads(); second.control.commandSquads(); }
    expect(hashSim(first.sim)).toBe(hashSim(second.sim));
    expect(first.commander.stats).toEqual(second.commander.stats);
  });

  it('targets visible hostile AI armies but ignores allies and unseen enemies', () => {
    const { hf, sim, economy, vision, commander, units } = hardAssaultFixture();
    sim.rules.allianceSides = { 1: 1, 2: 2, 3: 3, 4: 2 };
    createInitialBase(sim, hf, createEconomy(1), 170, 170);
    const otherAI = createInitialBase(sim, hf, createEconomy(3), 40, 0);
    createInitialBase(sim, hf, createEconomy(4), -40, 0);
    vi.spyOn(vision, 'isVisibleWorld').mockImplementation((x, z) => Math.abs(z) < 10 && x < 100);
    const target = (commander as unknown as { pickTarget: (squad: { units: typeof units }) => { entity?: { team?: { id: number } } } }).pickTarget({ units });
    expect(target.entity).toBe(otherAI);
    expect(target.entity?.team?.id).not.toBe(economy.team);
    vi.restoreAllMocks();
  });
  it('uses faction-specific infrastructure plans', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vision = new VisibilityGrid(hf, 2);
    const vesper = new EnemyCommander(sim, hf, createEconomy(2, 4600, 'missile-command'), vision, 'balanced', 'normal');
    const aegis = new EnemyCommander(sim, hf, createEconomy(3, 4600, 'iron-legion'), vision, 'balanced', 'normal', [], true);
    const vesperQueue = (vesper as unknown as { buildQueue: string[] }).buildQueue;
    const aegisQueue = (aegis as unknown as { buildQueue: string[] }).buildQueue;
    expect(vesperQueue).toContain('intelligence-center');
    expect(vesperQueue).toContain('strategic-silo');
    expect(vesperQueue).not.toContain('helipad');
    expect(aegisQueue).toContain('missile-defense');
    vi.restoreAllMocks();
  });

  it('lets a Vesper commander launch toward a known enemy deployment sector', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.allianceSides = { 1: 1, 2: 2 };
    const player = createEconomy(1);
    const playerBase = createInitialBase(sim, hf, player, -170, 0);
    const vesper = createEconomy(2, 5000, 'missile-command');
    const vesperBase = createInitialBase(sim, hf, vesper, 170, 0);
    vesper.powerProduced = 100;
    vesper.powerUsed = 0;
    sim.world.add({
      id: sim.nextEntityId++,
      name: 'Vesper Missile Silo',
      transform: { x: vesperBase.transform.x - 18, z: vesperBase.transform.z, rot: 0 },
      previousTransform: { x: vesperBase.transform.x - 18, z: vesperBase.transform.z, rot: 0 },
      health: { current: 820, max: 820 },
      team: { id: 2 },
      selectable: { selected: false, type: 'building', radius: 7 },
      collider: { radius: 7 },
      armor: { kind: 'building' },
      building: {
        kind: 'strategic-silo',
        label: 'Missile Silo',
        footprint: { w: 7, h: 7 },
        powerProduced: 0,
        powerUsed: 25,
        complete: true,
        buildProgress: 1,
      },
    });
    const commander = new EnemyCommander(
      sim,
      hf,
      vesper,
      new VisibilityGrid(hf, 2),
      'balanced',
      'normal',
      [{ x: playerBase.transform.x, z: playerBase.transform.z }],
    );

    (commander as unknown as { commandStrategicStrike: () => void }).commandStrategicStrike();

    expect(sim.projectiles.some((projectile) => projectile.strategic && projectile.teamId === 2 && projectile.strategicTargetTeamId === 1)).toBe(true);
    vi.restoreAllMocks();
  });

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
