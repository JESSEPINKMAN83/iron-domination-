import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { damageForArmor, manualFireAt, stepCombat } from './combat';
import { createEconomy, createInitialBase, placeStructure, spawnInfantryAt, startStructureBuild, stepEconomy, updatePlacement } from './economy';
import { generateHeightfield, sampleHeight } from './heightfield';
import { applyStructureDamage, cellIndex } from './structureDamage';
import { createGameSim, hashSim, issueMoveOrder, spawnScoutTankAt, spawnSiegeTankAt, spawnTankAt, spawnVultureAt, stepSim } from './world';

const settle = (sim: ReturnType<typeof createGameSim>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) stepCombat(sim, 1 / 30);
};

describe('phase 4 combat simulation', () => {
  it('applies weapon damage matrix values', () => {
    expect(damageForArmor('rifle', 'heavy')).toBeCloseTo(2.2);
    expect(damageForArmor('sniperRifle', 'infantry')).toBeCloseTo(86.4);
    expect(damageForArmor('cannon', 'heavy')).toBeCloseTo(5.76);
    expect(damageForArmor('bomb', 'heavy')).toBeCloseTo(15.08);
    expect(damageForArmor('bomb', 'building')).toBeCloseTo(7.8);
  });

  it('lets a sniper manually pick infantry from long range', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const sniper = spawnInfantryAt(sim, -160, 0, 1, 'sniper');
    const target = spawnInfantryAt(sim, 150, 0, 2, 'infantry');
    sniper.turret!.yaw = Math.PI / 2;

    expect(manualFireAt(sim, sniper, target.transform.x, target.transform.z, 'primary')).toBe(true);

    expect(sniper.weapon?.kind).toBe('sniperRifle');
    expect(sniper.weapon?.range).toBe(320);
    expect(target.health?.current).toBe(0);
    expect(sim.events[sim.events.length - 1]?.kind).toBe('sniperRifle');
  });

  it('lets a player-controlled sniper fire again after reload', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const sniper = spawnInfantryAt(sim, -160, 0, 1, 'sniper');
    const first = spawnInfantryAt(sim, 140, 0, 2, 'infantry');
    const second = spawnInfantryAt(sim, 145, 8, 2, 'infantry');
    sniper.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    sniper.turret!.yaw = Math.PI / 2;

    expect(manualFireAt(sim, sniper, first.transform.x, first.transform.z, 'primary')).toBe(true);
    expect(manualFireAt(sim, sniper, second.transform.x, second.transform.z, 'primary')).toBe(false);
    settle(sim, 1.4);
    sniper.turret!.yaw = Math.PI / 2;

    expect(manualFireAt(sim, sniper, second.transform.x, second.transform.z, 'primary')).toBe(true);
    expect(second.health?.current).toBe(0);
  });

  it('resolves a deterministic tank engagement and records combat events', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const a = spawnTankAt(sim, -20, -20, 'A');
      const b = spawnTankAt(sim, 18, -20, 'B', 2);
      settle(sim, 8);
      return { sim, aHp: a.health?.current ?? 0, bHp: b.health?.current ?? 0, events: sim.events.length, hash: hashSim(sim) };
    };

    const first = run();
    const second = run();
    expect(first.hash).toBe(second.hash);
    expect(first.events).toBeGreaterThan(0);
    expect(first.aHp).toBeLessThan(100);
    expect(first.bHp).toBeLessThan(100);
  });

  it('gates direct fire on turret traverse — misaligned turret holds fire', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    const target = spawnTankAt(sim, 18, -20, 'B', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    attacker.turret!.yaw = -Math.PI / 2; // pointing away

    expect(manualFireAt(sim, attacker, 42, -20)).toBe(false);
    expect(target.health?.current).toBe(100);

    attacker.turret!.yaw = Math.PI / 2; // traversed onto the shot line
    expect(manualFireAt(sim, attacker, 42, -20)).toBe(true);
    expect(sim.events.at(-1)?.kind).toBe('tankMissile');
    settle(sim, 0.6);
    expect(target.health?.current).toBeLessThan(100);
    const event = sim.events.at(-1);
    expect(event?.sourceTeamId).toBe(1);
    expect(event?.targetId).toBe(target.id);
    expect(event?.targetLabel).toBe('B');
    expect(event?.targetHealth).toBe(target.health?.current);
    expect(event?.targetMaxHealth).toBe(100);
    expect(attacker.weapons?.primary.cooldown).toBeGreaterThan(0);
  });

  it('lets low-accuracy AI direct fire miss instead of always landing perfect hits', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'Easy AI', 2);
    const target = spawnTankAt(sim, 20, -20, 'Player', 1);
    target.weapon = undefined;
    target.weapons = undefined;
    attacker.turret!.yaw = Math.PI / 2;
    attacker.weapons!.secondary = undefined;
    attacker.aiCombat = {
      accuracy: 0,
      cooldownMultiplier: 2,
      projectileScatter: 12,
      targetAcquireDelayTicks: 0,
      possessedTargetPriority: 1,
    };

    stepCombat(sim, 1 / 30);

    const event = sim.events.at(-1);
    expect(event?.kind).toBe('tankMissile');
    expect(event?.damage).toBe(0);
    expect(target.health?.current).toBe(100);
    expect(attacker.weapons?.primary.cooldown).toBeCloseTo(1.8);
    expect(Math.hypot((event?.toX ?? 0) - target.transform.x, (event?.toZ ?? 0) - target.transform.z)).toBeGreaterThan(1.5);
  });

  it('manual combat mode prevents idle auto-fire until the player issues attack-move', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const attacker = spawnTankAt(sim, -20, -20, 'Manual Tank');
    const target = spawnTankAt(sim, 18, -20, 'Target', 2);
    attacker.turret!.yaw = Math.PI / 2;

    settle(sim, 2);
    expect(sim.events.some((event) => event.kind === 'tankMissile')).toBe(false);
    expect(target.health?.current).toBe(100);

    expect(issueMoveOrder(sim, [attacker], 42, -20, true)).toBe(true);
    settle(sim, 0.7);

    expect(sim.events.some((event) => event.kind === 'tankMissile')).toBe(true);
    expect(target.health?.current).toBeLessThan(100);
  });

  it('preserves manual direct-fire aim height when shooting above the ground', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI };
    attacker.turret!.yaw = Math.PI;
    const targetX = -20;
    const targetZ = -100;
    const aimY = sampleHeight(hf, targetX, targetZ) + 20;

    expect(manualFireAt(sim, attacker, targetX, targetZ, 'primary', aimY)).toBe(true);

    const event = sim.events.at(-1);
    expect(event?.kind).toBe('tankMissile');
    expect(event?.toY).toBe(aimY);
    expect(event?.toY).toBeGreaterThan(sampleHeight(hf, event!.toX, event!.toZ) + 8);
  });

  it('lets manually aimed tank missiles travel to distant battlefield points', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const attacker = spawnTankAt(sim, -180, -20, 'Long Shot');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    attacker.turret!.yaw = Math.PI / 2;

    expect(manualFireAt(sim, attacker, 280, -20)).toBe(true);

    const launch = sim.events.at(-1);
    expect(launch?.kind).toBe('tankMissile');
    expect(launch?.toX).toBe(280);
    expect(sim.projectiles[0]?.toX).toBe(280);
    expect(sim.projectiles[0]?.duration).toBe(3.2);
    settle(sim, 3.25);
    expect(sim.events.some((event) => event.kind === 'tankMissile-impact' && event.toX === 280)).toBe(true);
  });

  it('fires ballistic bombs that damage on impact, with splash falloff', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    const primary = spawnTankAt(sim, 18, -20, 'B', 2);
    const nearby = spawnTankAt(sim, 22, -20, 'C', 2);
    primary.weapon = undefined;
    primary.weapons = undefined;
    nearby.weapon = undefined;
    nearby.weapons = undefined;
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, primary.transform.x, primary.transform.z, 'secondary');
    const firedAgain = manualFireAt(sim, attacker, primary.transform.x, primary.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(firedAgain).toBe(false);
    expect(sim.projectiles).toHaveLength(2);
    expect(sim.events.at(-1)?.kind).toBe('bomb');
    // no damage until the bomb lands
    expect(primary.health?.current).toBe(100);

    settle(sim, 1.5);
    const impact = sim.events.find((event) => event.kind === 'bomb-impact');
    expect(sim.projectiles).toHaveLength(0);
    expect(impact).toBeDefined();
    expect(impact?.sourceTeamId).toBe(1);
    expect(impact?.targetId).toBeDefined();
    expect(impact?.targetHealth).toBeLessThan(100);
    expect(impact?.targetMaxHealth).toBe(100);
    expect(primary.health?.current).toBeLessThan(100);
    expect(nearby.health?.current).toBeLessThan(100);
    expect(nearby.health?.current).toBeGreaterThan(80);
  });

  it('lets player-controlled bombs fire beyond normal range with deterministic scatter', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, 360, -20, 'secondary');

    expect(fired).toBe(true);
    expect(sim.events).toHaveLength(2);
    expect(Math.hypot(sim.events[0].toX - attacker.transform.x, sim.events[0].toZ - attacker.transform.z)).toBeGreaterThan(152);
    expect(sim.events[0].toX).not.toBeCloseTo(360);
    expect(sim.events.every((event) => event.kind === 'bomb')).toBe(true);
  });

  it('keeps a manually fired bomb safely away from the firing tank', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, attacker.transform.x, attacker.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(Math.hypot(sim.events[0].toX - attacker.transform.x, sim.events[0].toZ - attacker.transform.z)).toBeGreaterThan(40);
    settle(sim, 1.5);
    expect(attacker.health?.current).toBe(100); // own splash never hurts own team
  });

  it('lets possessed aircraft drop bombs almost directly below themselves', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -14, -20, 'Vulture 1');
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: 0, climb: 0 };

    const fired = manualFireAt(sim, vulture, vulture.transform.x, vulture.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(sim.projectiles).toHaveLength(2);
    expect(sim.events[0]?.trajectory).toBe('drop');
    const bombs = sim.events.filter((event) => event.kind === 'bomb');
    const centerX = bombs.reduce((sum, event) => sum + event.toX, 0) / bombs.length;
    const centerZ = bombs.reduce((sum, event) => sum + event.toZ, 0) / bombs.length;
    expect(Math.hypot(centerX - vulture.transform.x, centerZ - vulture.transform.z)).toBeLessThan(0.1);
    expect(Math.max(...bombs.map((event) => Math.hypot(event.toX - vulture.transform.x, event.toZ - vulture.transform.z)))).toBeLessThan(2.5);
    expect(sim.events[0]?.fromY).toBeGreaterThan(sampleHeight(hf, vulture.transform.x, vulture.transform.z) + 20);
  });

  it('lets a moving possessed tank dodge enemy bombs — and punishes standing still', () => {
    const run = (dodge: boolean) => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const player = spawnTankAt(sim, -20, -20, 'A');
      const enemy = spawnTankAt(sim, -20, 45, 'B', 2);
      player.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
      enemy.weapons!.primary.cooldown = 999; // isolate the bomb
      enemy.turret!.yaw = Math.PI; // facing the player

      stepCombat(sim, 1 / 30);
      expect(sim.events.some((event) => event.kind === 'bomb')).toBe(true);
      if (dodge) {
        player.transform.x += 30; // drove away during the flight
        player.previousTransform.x += 30;
      }
      settle(sim, 2);
      return player.health?.current ?? 0;
    };

    expect(run(true)).toBe(100);
    expect(run(false)).toBeLessThan(100);
  });

  it('lets a player-controlled Vulture fire rockets at ground targets', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -14, -20, 'Vulture 1');
    const enemy = spawnTankAt(sim, 24, 18, 'Target', 2);
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.atan2(enemy.transform.x - vulture.transform.x, enemy.transform.z - vulture.transform.z), climb: 0 };
    if (vulture.turret) vulture.turret.yaw = vulture.playerControlled.aimYaw;

    const fired = manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'primary');

    expect(fired).toBe(true);
    expect(enemy.health?.current).toBeLessThan(100);
    expect(vulture.weapons?.primary.cooldown).toBeGreaterThan(0);
  });

  it('lets a player-controlled Vulture launch a twin bomb salvo', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -14, -20, 'Vulture 1');
    const enemy = spawnTankAt(sim, 24, 18, 'Target', 2);
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.atan2(enemy.transform.x - vulture.transform.x, enemy.transform.z - vulture.transform.z), climb: 0 };

    const fired = manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(vulture.weapons?.secondary?.kind).toBe('bomb');
    expect(vulture.weapons?.secondary?.salvoCount).toBe(2);
    expect(sim.projectiles).toHaveLength(2);
    expect(sim.events.at(-1)?.kind).toBe('bomb');
    expect(sim.events.at(-1)?.trajectory).toBe('drop');
    expect(sim.events.at(-1)?.fromY).toBeGreaterThan(sampleHeight(hf, vulture.transform.x, vulture.transform.z) + 20);
    expect(enemy.health?.current).toBe(100);

    settle(sim, 1.5);
    expect(enemy.health?.current).toBeLessThan(100);
    expect(sim.events.filter((event) => event.kind === 'bomb-impact')).toHaveLength(2);
    expect(vulture.weapons?.secondary?.cooldown).toBeGreaterThan(0);
  });

  it('reloads possessed aircraft weapons in passive lineup combat mode', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -14, -20, 'Vulture 1');
    const enemy = spawnTankAt(sim, 24, 18, 'Target', 2);
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.atan2(enemy.transform.x - vulture.transform.x, enemy.transform.z - vulture.transform.z), climb: 0 };
    if (vulture.turret) vulture.turret.yaw = vulture.playerControlled.aimYaw;

    expect(manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'primary')).toBe(true);
    expect(manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'secondary')).toBe(true);
    expect(manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'primary')).toBe(false);
    expect(manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'secondary')).toBe(false);

    for (let i = 0; i < Math.round(4.2 * 30); i++) stepCombat(sim, 1 / 30, { autoFire: false });
    if (vulture.turret) vulture.turret.yaw = vulture.playerControlled.aimYaw;

    expect(vulture.weapons?.primary.cooldown).toBe(0);
    expect(vulture.weapons?.secondary?.cooldown).toBe(0);
    expect(manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'primary')).toBe(true);
    expect(manualFireAt(sim, vulture, enemy.transform.x, enemy.transform.z, 'secondary')).toBe(true);
  });

  it('reloads possessed ground vehicle weapons in passive lineup combat mode', () => {
    const variants = [
      { name: 'Jackal', spawn: spawnScoutTankAt },
      { name: 'M-17', spawn: spawnTankAt },
      { name: 'Mauler', spawn: spawnSiegeTankAt },
    ];

    for (const variant of variants) {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const vehicle = variant.spawn(sim, -20, -20, variant.name);
      const enemy = spawnTankAt(sim, 40, -20, 'Target', 2);
      const aimYaw = Math.atan2(enemy.transform.x - vehicle.transform.x, enemy.transform.z - vehicle.transform.z);
      vehicle.playerControlled = { throttle: 0, turn: 0, aimYaw };
      if (vehicle.turret) vehicle.turret.yaw = aimYaw;

      expect(manualFireAt(sim, vehicle, enemy.transform.x, enemy.transform.z, 'primary')).toBe(true);
      expect(manualFireAt(sim, vehicle, enemy.transform.x, enemy.transform.z, 'secondary')).toBe(true);
      expect(manualFireAt(sim, vehicle, enemy.transform.x, enemy.transform.z, 'primary')).toBe(false);
      expect(manualFireAt(sim, vehicle, enemy.transform.x, enemy.transform.z, 'secondary')).toBe(false);

      for (let i = 0; i < Math.round(4.2 * 30); i++) stepCombat(sim, 1 / 30, { autoFire: false });
      if (vehicle.turret) vehicle.turret.yaw = aimYaw;

      expect(vehicle.weapons?.primary.cooldown).toBe(0);
      expect(vehicle.weapons?.secondary?.cooldown).toBe(0);
      expect(manualFireAt(sim, vehicle, enemy.transform.x, enemy.transform.z, 'primary')).toBe(true);
      expect(manualFireAt(sim, vehicle, enemy.transform.x, enemy.transform.z, 'secondary')).toBe(true);
    }
  });

  it('prevents ordinary tank cannon fire from targeting airborne Vultures', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -20, -20, 'Vulture 1');
    const tank = spawnTankAt(sim, -20, 24, 'Ash Tank', 2);
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: 0, climb: 0 };
    tank.weapons!.secondary!.cooldown = 999;
    tank.turret!.yaw = Math.atan2(vulture.transform.x - tank.transform.x, vulture.transform.z - tank.transform.z);

    settle(sim, 6);

    expect(vulture.health?.current).toBe(160);
    expect(sim.events.some((event) => event.kind === 'cannon' && event.targetId === vulture.id)).toBe(false);
  });

  it('lets ground bomb splash only graze aircraft', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, -20, -20, 'Bomber', 2);
    const vulture = spawnVultureAt(sim, hf, 20, -20, 'Vulture 1');
    tank.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    expect(manualFireAt(sim, tank, vulture.transform.x, vulture.transform.z, 'secondary')).toBe(true);
    settle(sim, 1.5);

    expect(vulture.health?.current).toBeGreaterThan(158);
    expect(sim.events.some((event) => event.kind === 'bomb-impact')).toBe(true);
  });

  it('gives AA missile towers a real anti-air role', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(2, 5200);
    const base = createInitialBase(sim, hf, economy, 2);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    let placement = updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z, 2);
    expect(placeStructure(sim, hf, economy, placement)).toBeDefined();

    expect(startStructureBuild(sim, economy, 'aa-tower')).toBe(true);
    for (let i = 0; i < 30 * 8; i++) stepEconomy(sim, hf, economy, 1 / 30);
    placement = updatePlacement(sim, hf, 'aa-tower', base.transform.x + 24, base.transform.z, 2);
    const tower = placeStructure(sim, hf, economy, placement);
    expect(tower?.weapon?.kind).toBe('aaMissile');

    const vulture = spawnVultureAt(sim, hf, tower!.transform.x + 58, tower!.transform.z, 'Vulture 1');
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: 0, climb: 0 };
    settle(sim, 6);

    expect(vulture.health?.current).toBeLessThan(80);
    expect(sim.events.some((event) => event.kind === 'aaMissile' && event.targetId === vulture.id)).toBe(true);
  });

  it('walls block ground navigation until destroyed', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    let placement = updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z);
    expect(placeStructure(sim, hf, economy, placement)).toBeDefined();

    expect(startStructureBuild(sim, economy, 'wall')).toBe(true);
    for (let i = 0; i < 30 * 2; i++) stepEconomy(sim, hf, economy, 1 / 30);
    placement = updatePlacement(sim, hf, 'wall', base.transform.x + 22, base.transform.z);
    const wall = placeStructure(sim, hf, economy, placement);
    expect(wall).toBeDefined();
    const cell = sim.nav.worldToCell(wall!.transform.x, wall!.transform.z);
    expect(sim.nav.isWalkableCell(cell.x, cell.y)).toBe(false);

    const attacker = spawnTankAt(sim, wall!.transform.x, wall!.transform.z - 24, 'Breacher', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    attacker.turret!.yaw = 0;
    wall!.health!.current = 1;
    expect(manualFireAt(sim, attacker, wall!.transform.x, wall!.transform.z)).toBe(true);
    settle(sim, 0.6);

    expect(wall!.destroyed).toBeDefined();
    expect(sim.nav.isWalkableCell(cell.x, cell.y)).toBe(true);
  });

  it('guard towers automatically fire at nearby enemies', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    let placement = updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z);
    expect(placeStructure(sim, hf, economy, placement)).toBeDefined();

    expect(startStructureBuild(sim, economy, 'guard-tower')).toBe(true);
    for (let i = 0; i < 30 * 7; i++) stepEconomy(sim, hf, economy, 1 / 30);
    placement = updatePlacement(sim, hf, 'guard-tower', base.transform.x + 24, base.transform.z);
    const tower = placeStructure(sim, hf, economy, placement);
    expect(tower?.weapon?.kind).toBe('cannon');

    const enemy = spawnTankAt(sim, tower!.transform.x + 34, tower!.transform.z, 'Raider', 2);
    settle(sim, 4);

    expect(enemy.health?.current).toBeLessThan(100);
    expect(sim.events.some((event) => event.kind === 'cannon')).toBe(true);
  });

  it('alerts nearby defenders when a friendly building is hit from long range', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);
    const defender = spawnTankAt(sim, base.transform.x + 28, base.transform.z, 'Home Guard');
    const attacker = spawnTankAt(sim, base.transform.x + 190, base.transform.z, 'Siege Tank', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: -Math.PI / 2 };

    expect(manualFireAt(sim, attacker, base.transform.x, base.transform.z, 'secondary')).toBe(true);
    settle(sim, 3);

    expect(base.health?.current).toBeLessThan(base.health!.max);
    expect(defender.mover?.defenseAlert?.targetId).toBe(attacker.id);
    const before = defender.transform.x;
    for (let i = 0; i < 30; i++) {
      stepCombat(sim, 1 / 30);
      stepSim(sim, hf, 1 / 30);
    }
    expect(defender.transform.x).toBeGreaterThan(before);
  });

  it('manual defense mode does not auto-rally defenders after a base hit', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    sim.rules.autoDefense = false;
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);
    const defender = spawnTankAt(sim, base.transform.x + 28, base.transform.z, 'Home Guard');
    const attacker = spawnTankAt(sim, base.transform.x + 190, base.transform.z, 'Raider', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: -Math.PI / 2 };

    expect(manualFireAt(sim, attacker, base.transform.x, base.transform.z, 'secondary')).toBe(true);
    settle(sim, 3);

    expect(base.health?.current).toBeLessThan(base.health!.max);
    expect(defender.mover?.defenseAlert).toBeUndefined();
    expect(defender.mover?.engage).toBeUndefined();
    expect(defender.weapon?.targetId).toBeUndefined();
  });

  it('alerts nearby defenders when a friendly harvester is hit', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    expect(startStructureBuild(sim, economy, 'power-plant')).toBe(true);
    for (let i = 0; i < 30 * 5; i++) stepEconomy(sim, hf, economy, 1 / 30);
    expect(placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'power-plant', base.transform.x - 28, base.transform.z))).toBeDefined();
    expect(startStructureBuild(sim, economy, 'refinery')).toBe(true);
    for (let i = 0; i < 30 * 8; i++) stepEconomy(sim, hf, economy, 1 / 30);
    expect(placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'refinery', base.transform.x + 28, base.transform.z))).toBeDefined();
    const harvester = stepEconomy(sim, hf, economy, 1 / 30).find((entity) => entity.harvester);
    expect(harvester).toBeDefined();

    const defender = spawnTankAt(sim, harvester!.transform.x - 24, harvester!.transform.z, 'Collector Guard');
    const attacker = spawnTankAt(sim, harvester!.transform.x + 44, harvester!.transform.z, 'Collector Raider', 2);
    const yaw = Math.atan2(harvester!.transform.x - attacker.transform.x, harvester!.transform.z - attacker.transform.z);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: yaw };
    attacker.turret!.yaw = yaw;

    expect(manualFireAt(sim, attacker, harvester!.transform.x, harvester!.transform.z)).toBe(true);
    settle(sim, 0.7);

    expect(harvester!.health?.current).toBeLessThan(harvester!.health!.max);
    expect(defender.mover?.defenseAlert?.targetId).toBe(attacker.id);
    expect(defender.weapon?.targetId).toBe(attacker.id);
  });

  it('tracks localized deterministic structure damage by facade and tier', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const economy = createEconomy(1, 5200);
      const base = createInitialBase(sim, hf, economy, 0, 0);
      applyStructureDamage(base, {
        hitX: base.transform.x,
        hitZ: base.transform.z,
        hitY: base.transform.y,
        fromX: base.transform.x - 90,
        fromZ: base.transform.z,
        amount: 40,
        splashRadius: 0,
        trajectory: 'flat',
      });
      return { hash: hashSim(sim), damage: base.structureDamage! };
    };

    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    const west = facadeSum(a.damage, 'west');
    const east = facadeSum(a.damage, 'east');
    expect(west).toBeGreaterThan(east * 3);
  });

  it('makes the first ordinary building hit visibly mark the struck cells', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy, 0, 0);

    applyStructureDamage(base, {
      hitX: base.transform.x,
      hitZ: base.transform.z,
      hitY: base.transform.y,
      fromX: base.transform.x - 90,
      fromZ: base.transform.z,
      amount: damageForArmor('cannon', 'building'),
      splashRadius: 0,
      trajectory: 'flat',
    });

    expect(Math.max(...base.structureDamage!.cells)).toBeGreaterThanOrEqual(42);
  });

  it('biases arcing structure damage upward and splashes to neighbors with support bleed', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy, 0, 0);
    const damage = base.structureDamage!;
    const cx = Math.floor(damage.cols / 2);
    const rz = Math.floor(damage.rows / 2);

    applyStructureDamage(base, {
      hitX: base.transform.x,
      hitZ: base.transform.z,
      hitY: (base.transform.y ?? 0) + 3,
      fromX: base.transform.x,
      fromZ: base.transform.z - 120,
      amount: 65,
      splashRadius: 10,
      trajectory: 'arc',
    });

    const lower = damage.cells[cellIndex(damage, cx, rz, 0)];
    const upper = damage.cells[cellIndex(damage, cx, rz, 1)];
    expect(upper).toBeGreaterThan(lower);
    expect(neighborSum(damage, cx, rz, 1)).toBeGreaterThan(0);

    const facadeCol = 0;
    damage.cells[cellIndex(damage, facadeCol, rz, 0)] = 199;
    const facadeUpperBefore = damage.cells[cellIndex(damage, facadeCol, rz, 1)];
    applyStructureDamage(base, {
      hitX: base.transform.x,
      hitZ: base.transform.z,
      fromX: base.transform.x - 90,
      fromZ: base.transform.z,
      amount: 12,
      splashRadius: 0,
      trajectory: 'flat',
    });
    expect(damage.cells[cellIndex(damage, facadeCol, rz, 1)]).toBeGreaterThan(facadeUpperBefore);
  });

  it('does not auto-engage aircraft beyond the shooter vision, even within airRange', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    // rocket-infantry: vision 94, aaMissile airRange 145
    const rockets = spawnInfantryAt(sim, 0, 0, 1, 'rocket-infantry');
    const visionRadius = rockets.vision?.radius ?? 0;
    expect(visionRadius).toBeLessThan(145);
    // enemy vulture parked beyond vision but well inside aaMissile airRange
    const distance = (visionRadius + 145) / 2;
    spawnVultureAt(sim, hf, distance, 0, 'Vulture 1', 2);

    for (let i = 0; i < 30 * 3; i++) stepCombat(sim, 1 / 30);
    expect(sim.projectiles.some((p) => p.kind === 'aaMissile')).toBe(false);
    expect(sim.events.some((e) => e.kind === 'aaMissile')).toBe(false);

    // sanity: once the aircraft is inside vision, the rocket team DOES fire an AA missile
    spawnVultureAt(sim, hf, visionRadius - 20, 0, 'Vulture 2', 2);
    let fired = false;
    for (let i = 0; i < 30 * 3 && !fired; i++) {
      stepCombat(sim, 1 / 30);
      fired = sim.projectiles.some((p) => p.kind === 'aaMissile') || sim.events.some((e) => e.kind === 'aaMissile');
    }
    expect(fired).toBe(true);
  });
});

function facadeSum(damage: NonNullable<ReturnType<typeof createInitialBase>['structureDamage']>, side: 'west' | 'east'): number {
  const col = side === 'west' ? 0 : damage.cols - 1;
  let sum = 0;
  for (let tier = 0; tier < damage.tiers; tier++) {
    for (let row = 0; row < damage.rows; row++) sum += damage.cells[cellIndex(damage, col, row, tier)];
  }
  return sum;
}

function neighborSum(damage: NonNullable<ReturnType<typeof createInitialBase>['structureDamage']>, col: number, row: number, tier: number): number {
  let sum = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const c = col + dx;
      const r = row + dz;
      if (c < 0 || c >= damage.cols || r < 0 || r >= damage.rows) continue;
      sum += damage.cells[cellIndex(damage, c, r, tier)];
    }
  }
  return sum;
}
