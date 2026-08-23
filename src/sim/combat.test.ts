import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { WEAPONS, type WeaponKind } from '../content/phase4';
import {
  canManualWeaponLockStrategic,
  canManualWeaponLockTarget,
  damageForArmor,
  isManualTargetLockWeapon,
  issueAttackOrder,
  issueGroundAttack,
  manualFireAt,
  predictiveDefenseTowerAimPoint,
  stepCombat,
} from './combat';
import { createEconomy, createInitialBase, placeStructure, spawnInfantryAt, startStructureBuild, stepEconomy, updatePlacement } from './economy';
import { generateHeightfield, sampleHeight } from './heightfield';
import { applyStructureDamage, cellIndex } from './structureDamage';
import { purchaseUnitUpgrade } from './upgrades';
import type { Entity } from './components';
import {
  createGameSim,
  hashSim,
  issueMoveOrder,
  spawnHammerheadAt as spawnCurrentHammerheadAt,
  spawnScoutTankAt as spawnCurrentScoutTankAt,
  spawnSiegeTankAt as spawnCurrentSiegeTankAt,
  spawnTankAt as spawnCurrentTankAt,
  spawnVultureAt as spawnCurrentVultureAt,
  spawnWaspAt as spawnCurrentWaspAt,
  stepSim,
} from './world';

/**
 * Most tests below isolate long-standing projectile and bomb mechanics. Give
 * those fixtures their historical weapons explicitly; current roster identity
 * is asserted separately in unitArsenal.test.ts.
 */
function legacyLoadout(entity: Entity, primary: WeaponKind, secondary?: WeaponKind, salvoCount?: number): Entity {
  const primaryWeapon = { kind: primary, range: WEAPONS[primary].range, cooldown: 0 };
  entity.weapon = primaryWeapon;
  entity.weapons = {
    primary: primaryWeapon,
    secondary: secondary ? { kind: secondary, range: WEAPONS[secondary].range, cooldown: 0, salvoCount } : undefined,
  };
  return entity;
}

const spawnTankAt = (...args: Parameters<typeof spawnCurrentTankAt>) =>
  legacyLoadout(spawnCurrentTankAt(...args), 'tankMissile', 'tankBomb', 2);
const spawnScoutTankAt = (...args: Parameters<typeof spawnCurrentScoutTankAt>) =>
  legacyLoadout(spawnCurrentScoutTankAt(...args), 'scoutMissile', 'tankBomb', 1);
const spawnSiegeTankAt = (...args: Parameters<typeof spawnCurrentSiegeTankAt>) =>
  legacyLoadout(spawnCurrentSiegeTankAt(...args), 'siegeMissile', 'tankBomb', 4);
const spawnWaspAt = (...args: Parameters<typeof spawnCurrentWaspAt>) =>
  legacyLoadout(spawnCurrentWaspAt(...args), 'waspAutocannon', 'bomb', 1);
const spawnVultureAt = (...args: Parameters<typeof spawnCurrentVultureAt>) =>
  legacyLoadout(spawnCurrentVultureAt(...args), 'rocketPod', 'bomb', 2);
const spawnHammerheadAt = (...args: Parameters<typeof spawnCurrentHammerheadAt>) =>
  legacyLoadout(spawnCurrentHammerheadAt(...args), 'agMissile', 'bomb', 4);

const settle = (sim: ReturnType<typeof createGameSim>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) stepCombat(sim, 1 / 30);
};

describe('phase 4 combat simulation', () => {
  it('applies weapon damage matrix values', () => {
    expect(damageForArmor('rifle', 'heavy')).toBeCloseTo(2.2);
    expect(damageForArmor('sniperRifle', 'infantry')).toBeCloseTo(86.4);
    expect(damageForArmor('cannon', 'heavy')).toBeCloseTo(26.32);
    expect(damageForArmor('autocannon', 'heavy')).toBeCloseTo(0.4);
    expect(damageForArmor('heavyCannon', 'building')).toBeCloseTo(47.56);
    expect(damageForArmor('bomb', 'heavy')).toBeCloseTo(15.08);
    expect(damageForArmor('bomb', 'building')).toBeCloseTo(7.8);
    expect(damageForArmor('tankBomb', 'heavy')).toBeCloseTo(34.44);
    expect(damageForArmor('tankBomb', 'building')).toBeCloseTo(23.1);
  });

  it('keeps a Mauler artillery shell alive through the ascending half of its arc', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const mauler = spawnCurrentSiegeTankAt(sim, -90, -20, 'V-mode Mauler');
    mauler.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    mauler.turret!.yaw = Math.PI / 2;
    const targetX = 90;
    const targetZ = -20;

    expect(manualFireAt(sim, mauler, targetX, targetZ, 'primary', sampleHeight(hf, targetX, targetZ) + 1)).toBe(true);
    const duration = sim.projectiles[0]?.duration ?? 0;
    for (let i = 0; i < Math.floor(duration * 0.55 * 30); i++) stepCombat(sim, 1 / 30, { autoFire: false });

    expect(sim.projectiles.some((projectile) => projectile.weaponKind === 'heavyCannon')).toBe(true);
    expect(sim.events.some((event) => event.kind === 'artilleryShell-impact')).toBe(false);
  });

  it('does not magnetize a possessed Jackal shot toward a near-miss enemy', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const jackal = spawnCurrentScoutTankAt(sim, 0, 0, 'V-mode Jackal');
    const enemy = spawnCurrentSiegeTankAt(sim, 40, 0, 'Off-reticle Mauler', 2);
    const targetX = 60;
    const targetZ = 5.4;
    const aimYaw = Math.atan2(targetX - jackal.transform.x, targetZ - jackal.transform.z);
    jackal.playerControlled = { throttle: 0, turn: 0, aimYaw };
    jackal.turret!.yaw = aimYaw;

    expect(manualFireAt(sim, jackal, targetX, targetZ, 'primary', sampleHeight(hf, targetX, targetZ) + 1.2)).toBe(true);

    const event = sim.events.at(-1);
    expect(event?.kind).toBe('autocannon');
    expect(event?.targetId).toBeUndefined();
    expect(event?.damage).toBe(0);
    expect(enemy.health?.current).toBe(enemy.health?.max);
  });

  it('uses an Aegis escort drone to defend against nearby infantry before assisting the tank target', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 2000);
    const tank = spawnTankAt(sim, 0, 0, 'Drone Tank', 1);
    const tankTarget = spawnTankAt(sim, 40, 0, 'Tank Target', 2);
    const infantryThreat = spawnInfantryAt(sim, 18, 0, 2, 'infantry');
    tankTarget.weapon = undefined;
    tankTarget.weapons = undefined;
    infantryThreat.weapon = undefined;
    infantryThreat.weapons = undefined;
    expect(purchaseUnitUpgrade(sim, economy, [tank.id], 'reactive-plating').ok).toBe(true);
    tank.weapons!.primary.targetId = tankTarget.id;
    tank.weapons!.primary.cooldown = 99;
    if (tank.weapons!.secondary) tank.weapons!.secondary.cooldown = 99;

    stepCombat(sim, 1 / 30);
    const defensiveShot = sim.events.find((event) => event.kind === 'microLaser');
    expect(defensiveShot?.targetId).toBe(infantryThreat.id);
    expect(defensiveShot?.damage).toBeCloseTo(damageForArmor('microLaser', 'infantry'));

    infantryThreat.transform.x = 200;
    infantryThreat.previousTransform.x = 200;
    for (let i = 0; i < 18; i++) stepCombat(sim, 1 / 30);
    const assistShot = sim.events.filter((event) => event.kind === 'microLaser').at(-1);
    expect(assistShot?.targetId).toBe(tankTarget.id);
    expect(assistShot?.damage).toBeLessThan(1);
  });

  it('fires selected armed units at a designated ground point', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, -20, 0, 'Ground Fire Tank', 1);

    expect(issueGroundAttack(sim, [tank], 45, 18)).toBe(true);
    expect(tank.turret?.yaw).toBeCloseTo(Math.atan2(65, 18), 8);
    expect(sim.events.at(-1)?.toX).toBeCloseTo(45, 8);
    expect(sim.events.at(-1)?.toZ).toBeCloseTo(18, 8);
  });

  it('gives possessed primary fire platform-specific damage, force, and impact energy', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, 0, 'Player Tank', 1);
    const target = spawnTankAt(sim, 52, 0, 'Target Tank', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    attacker.turret!.yaw = Math.PI / 2;
    target.weapon = undefined;
    target.weapons = undefined;

    expect(manualFireAt(sim, attacker, target.transform.x, target.transform.z, 'primary')).toBe(true);
    const projectile = sim.projectiles.at(-1);
    expect(projectile?.speed).toBeCloseTo(WEAPONS.tankMissile.projectile!.speed, 8);
    expect(projectile?.damageScale).toBeGreaterThan(1);
    expect(projectile?.forceScale).toBeGreaterThan(projectile?.damageScale ?? 0);
    expect(projectile?.impactScale).toBeGreaterThan(1);

    for (let i = 0; i < 30; i++) stepCombat(sim, 1 / 30, { autoFire: false });
    const impact = sim.events.find((event) => event.kind === 'tankMissile-impact');
    expect(impact?.impactScale).toBe(projectile?.impactScale);
    expect(impact?.damage).toBeGreaterThan(damageForArmor('tankMissile', 'heavy'));
    expect(sim.events.some((event) => event.kind === 'impact-reaction' && (event.force ?? 0) > 0)).toBe(true);
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
    expect(attacker.weapons?.primary.cooldown).toBeCloseTo(WEAPONS.tankMissile.cooldown * 2);
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

  it('keeps a clicked building as the explicit target instead of attacking a nearer building', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -60, -20, 'Ordered Tank');
    const nearBuilding = createInitialBase(sim, hf, createEconomy(2), -24, -20);
    const orderedBuilding = createInitialBase(sim, hf, createEconomy(2), 12, -20);
    attacker.turret!.yaw = Math.atan2(
      orderedBuilding.transform.x - attacker.transform.x,
      orderedBuilding.transform.z - attacker.transform.z,
    );

    expect(issueAttackOrder(sim, [attacker], orderedBuilding)).toBe(true);
    stepCombat(sim, 1 / 30);

    expect(attacker.mover?.attackTargetId).toBe(orderedBuilding.id);
    expect(attacker.weapons?.primary.targetId).toBe(orderedBuilding.id);
    expect(attacker.weapons?.primary.targetId).not.toBe(nearBuilding.id);
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
    expect(sim.projectiles[0]?.manualAim).toBe(true);
  });

  it('keeps an upward rifle-grenade aim on a playable ground arc instead of launching it into the sky', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const rifleTeam = spawnInfantryAt(sim, 0, 0, 1, 'infantry');
    rifleTeam.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    rifleTeam.turret!.yaw = 0;

    expect(manualFireAt(sim, rifleTeam, 0, 1_000, 'secondary', 500)).toBe(true);

    const grenade = sim.projectiles.at(-1)!;
    expect(grenade.weaponKind).toBe('rifleGrenade');
    expect(grenade.toZ).toBeCloseTo(WEAPONS.rifleGrenade.range, 5);
    expect(grenade.toY).toBeCloseTo(sampleHeight(hf, grenade.toX, grenade.toZ) + 0.4, 5);
    expect(grenade.toY).toBeLessThan(50);

    let maxHeight = grenade.y ?? grenade.fromY ?? 0;
    const duration = grenade.duration;
    for (let i = 0; i < Math.ceil((duration + 0.1) * 30); i++) {
      stepCombat(sim, 1 / 30, { autoFire: false });
      maxHeight = Math.max(maxHeight, ...sim.projectiles.map((projectile) => projectile.y ?? 0));
    }

    expect(maxHeight).toBeLessThan((grenade.toY ?? 0) + 25);
    const impact = sim.events.find((event) => event.kind === 'grenade-impact');
    expect(impact?.toZ).toBeCloseTo(WEAPONS.rifleGrenade.range, 5);
    expect(impact?.toY).toBeCloseTo(grenade.toY ?? 0, 5);
  });

  it('lets player-controlled aircraft rockets follow the full terrain reticle ray', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const attacker = spawnHammerheadAt(sim, hf, -120, -20, 'V-mode Hammerhead');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    attacker.turret!.yaw = Math.PI / 2;
    const targetX = 180;
    const targetZ = -20;
    const targetY = sampleHeight(hf, targetX, targetZ) + 0.4;

    expect(manualFireAt(sim, attacker, targetX, targetZ, 'primary', targetY)).toBe(true);

    const projectile = sim.projectiles[0];
    expect(projectile?.kind).toBe('agMissile');
    expect(projectile?.toX).toBe(targetX);
    expect(projectile?.toZ).toBe(targetZ);
    expect(projectile?.toY).toBe(targetY);
    expect(projectile?.duration).toBeGreaterThan(0.9);
    expect(projectile?.duration).toBeCloseTo(
      300 / (WEAPONS.agMissile.projectile!.speed * 1.12),
      8,
    );
  });

  it('does not stop V-mode Vulture rocket pods at the AI acquisition range', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const attacker = spawnVultureAt(sim, hf, -120, -20, 'V-mode Vulture');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    attacker.turret!.yaw = Math.PI / 2;
    const targetX = 180;
    const targetZ = -20;
    const targetY = sampleHeight(hf, targetX, targetZ) + 0.4;

    expect(manualFireAt(sim, attacker, targetX, targetZ, 'primary', targetY)).toBe(true);

    const shot = sim.events.at(-1);
    expect(shot?.kind).toBe('atRocket');
    expect(shot?.toX).toBe(targetX);
    expect(shot?.toZ).toBe(targetZ);
    expect(shot?.toY).toBe(targetY);
    expect(Math.hypot(shot!.toX - shot!.fromX, shot!.toZ - shot!.fromZ)).toBeGreaterThan(
      attacker.weapons!.primary.range,
    );

    const duration = sim.projectiles.at(-1)?.duration ?? 0;
    settle(sim, duration + 0.1);
    const impact = sim.events.find((event) => event.kind === 'atRocket-impact');
    expect(impact?.toX).toBeCloseTo(targetX, 5);
    expect(impact?.toZ).toBeCloseTo(targetZ, 5);
    expect(impact?.toY).toBeCloseTo(targetY, 5);
  });

  it('does not let a unit below the center aim ray steal a manual shot', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, 0, 0, 'A');
    const lowTarget = spawnTankAt(sim, 0, 30, 'Low target', 2);
    attacker.transform.y = 0;
    lowTarget.transform.y = 0;
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    attacker.turret!.yaw = 0;

    expect(manualFireAt(sim, attacker, 0, 100, 'primary', 40)).toBe(true);

    expect(sim.projectiles[0]?.directTargetId).toBeUndefined();
    expect(sim.projectiles[0]?.toZ).toBe(100);
    expect(sim.projectiles[0]?.toY).toBe(40);
  });

  it('lets manually aimed tank missiles reach their distant terminal point without a late terrain dive', () => {
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
    expect(sim.projectiles[0]?.duration).toBeCloseTo(3.2, 8);
    settle(sim, (sim.projectiles[0]?.duration ?? 0) + 0.1);
    const impact = sim.events.find((event) => event.kind === 'tankMissile-impact');
    expect(impact).toBeDefined();
    expect(impact!.toX).toBeCloseTo(280, 5);
    expect(impact!.toZ).toBeCloseTo(-20, 5);
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
    expect(sim.events.at(-1)?.kind).toBe('tankBomb');
    // no damage until the bomb lands
    expect(primary.health?.current).toBe(100);

    settle(sim, 1.5);
    const impact = sim.events.find((event) => event.kind === 'tankBomb-impact');
    expect(sim.projectiles).toHaveLength(0);
    expect(impact).toBeDefined();
    expect(impact?.sourceTeamId).toBe(1);
    expect(impact?.targetId).toBeDefined();
    expect(impact?.targetHealth).toBeLessThan(100);
    expect(impact?.targetMaxHealth).toBe(100);
    expect(primary.health?.current).toBeLessThan(100);
    expect(nearby.health?.current).toBeLessThan(100);
    expect(nearby.health?.current).toBeGreaterThan(60);
  });

  it('transfers deterministic blast momentum to every surviving unit in the impact area', () => {
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
    if (attacker.weapons?.secondary) attacker.weapons.secondary.salvoCount = 1;

    expect(manualFireAt(sim, attacker, primary.transform.x, primary.transform.z, 'secondary')).toBe(true);
    for (let i = 0; i < Math.round(1.5 * 30); i++) stepCombat(sim, 1 / 30, { autoFire: false });

    const reactions = sim.events.filter((event) => event.kind === 'impact-reaction');
    const primaryReaction = reactions.find((event) => event.targetId === primary.id);
    const nearbyReaction = reactions.find((event) => event.targetId === nearby.id);
    expect(primaryReaction?.impactKind).toBe('tankBomb');
    expect(primaryReaction?.force).toBeGreaterThan(nearbyReaction?.force ?? 1);
    expect(nearbyReaction).toBeDefined();
    expect(Math.hypot(primary.velocity?.x ?? 0, primary.velocity?.z ?? 0)).toBeGreaterThan(0);
    expect(Math.hypot(nearby.velocity?.x ?? 0, nearby.velocity?.z ?? 0)).toBeGreaterThan(0);
  });

  it('throws a tank away from a missile without spinning the hull in place', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const attacker = spawnTankAt(sim, -40, 0, 'A');
    const target = spawnTankAt(sim, 28, 0, 'B', 2);
    target.weapon = undefined;
    target.weapons = undefined;
    target.transform.rot = 0;
    target.previousTransform.rot = 0;
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    attacker.turret!.yaw = Math.PI / 2;
    expect(issueMoveOrder(sim, [target], 28, 90)).toBe(true);

    expect(manualFireAt(sim, attacker, target.transform.x, target.transform.z, 'primary')).toBe(true);
    for (let i = 0; i < 50; i++) stepCombat(sim, 1 / 30, { autoFire: false });

    const reaction = sim.events.find((event) => event.kind === 'impact-reaction' && event.targetId === target.id);
    expect(reaction).toBeDefined();
    expect(target.impactMomentum).toBeDefined();
    expect(target.impactMomentum?.x ?? 0).toBeGreaterThan(0.4);

    const startX = target.transform.x;
    const startRot = target.transform.rot;
    let accumulatedYaw = 0;
    let prevRot = startRot;
    for (let i = 0; i < 24; i++) {
      stepSim(sim, hf, 1 / 30);
      const delta = Math.atan2(Math.sin(target.transform.rot - prevRot), Math.cos(target.transform.rot - prevRot));
      accumulatedYaw += Math.abs(delta);
      prevRot = target.transform.rot;
    }

    expect(target.transform.x - startX).toBeGreaterThan(0.55);
    expect(accumulatedYaw).toBeLessThan(Math.PI * 0.75);
    expect(Math.abs(Math.atan2(Math.sin(target.transform.rot - startRot), Math.cos(target.transform.rot - startRot)))).toBeLessThan(Math.PI * 0.55);
  });

  it('throws a tank in opposite directions for left and right flank hits', () => {
    const strike = (attackerX: number, aimYaw: number): number => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      sim.rules.autoCombat = false;
      const attacker = spawnTankAt(sim, attackerX, 0, 'A');
      const target = spawnTankAt(sim, 28, 0, 'B', 2);
      target.weapon = undefined;
      target.weapons = undefined;
      target.transform.rot = 0;
      target.previousTransform.rot = 0;
      attacker.playerControlled = { throttle: 0, turn: 0, aimYaw };
      attacker.turret!.yaw = aimYaw;
      expect(manualFireAt(sim, attacker, target.transform.x, target.transform.z, 'primary')).toBe(true);
      for (let i = 0; i < 50; i++) stepCombat(sim, 1 / 30, { autoFire: false });
      return target.impactMomentum?.x ?? 0;
    };

    const fromLeft = strike(-40, Math.PI / 2);
    const fromRight = strike(96, -Math.PI / 2);
    expect(fromLeft).toBeGreaterThan(0.4);
    expect(fromRight).toBeLessThan(-0.4);
  });

  it('slides a destroyed tank away from the killing missile instead of spinning in place', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const attacker = spawnTankAt(sim, -40, 0, 'A');
    const target = spawnTankAt(sim, 28, 0, 'B', 2);
    target.weapon = undefined;
    target.weapons = undefined;
    target.health!.current = 6;
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    attacker.turret!.yaw = Math.PI / 2;

    expect(manualFireAt(sim, attacker, target.transform.x, target.transform.z, 'primary')).toBe(true);
    for (let i = 0; i < 50; i++) stepCombat(sim, 1 / 30, { autoFire: false });

    expect(target.destroyed).toBeDefined();
    expect(target.impactMomentum).toBeDefined();
    const startX = target.transform.x;
    const startRot = target.transform.rot;
    for (let i = 0; i < 24; i++) stepSim(sim, hf, 1 / 30);

    expect(target.transform.x - startX).toBeGreaterThan(0.4);
    expect(Math.abs(Math.atan2(Math.sin(target.transform.rot - startRot), Math.cos(target.transform.rot - startRot)))).toBeLessThan(0.35);
  });

  it('destabilizes a surviving aircraft after a direct air-to-air hit', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnWaspAt(sim, hf, -20, -20, 'A');
    const aircraft = spawnVultureAt(sim, hf, 18, -20, 'B', 2);
    aircraft.weapon = undefined;
    aircraft.weapons = undefined;
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    if (attacker.turret) attacker.turret.yaw = Math.PI / 2;

    expect(manualFireAt(sim, attacker, aircraft.transform.x, aircraft.transform.z, 'primary')).toBe(true);

    const reaction = sim.events.find((event) => event.kind === 'impact-reaction' && event.targetId === aircraft.id);
    expect(reaction?.targetType).toBe('aircraft');
    expect(aircraft.health?.current).toBeGreaterThan(0);
    expect(aircraft.flight?.verticalVelocity).toBeGreaterThan(0);
    expect(Math.abs(aircraft.flight?.rollAttitude ?? 0)).toBeGreaterThan(0);
  });

  it('lands every manually aimed artillery missile on the requested reticle point', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -480, -480, 'A');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 4 };

    const fired = manualFireAt(sim, attacker, 480, 480, 'secondary');

    expect(fired).toBe(true);
    expect(sim.events).toHaveLength(2);
    expect(Math.hypot(sim.events[0].toX - attacker.transform.x, sim.events[0].toZ - attacker.transform.z)).toBeGreaterThan(1200);
    expect(sim.events[0].duration).toBe(8);
    expect(sim.events.every((event) => event.toX === 480 && event.toZ === 480)).toBe(true);
    expect(sim.events.every((event) => event.kind === 'tankBomb')).toBe(true);
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
      expect(sim.events.some((event) => event.kind === 'tankBomb')).toBe(true);
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
    expect(vulture.weapons?.primary.cooldown).toBeGreaterThan(0);
    settle(sim, 1);
    expect(enemy.health?.current).toBeLessThan(100);
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

      const reload = Math.max(
        WEAPONS[vehicle.weapons!.primary.kind as WeaponKind].cooldown,
        WEAPONS[vehicle.weapons!.secondary!.kind as WeaponKind].cooldown,
      );
      for (let i = 0; i < Math.round((reload + 0.2) * 30); i++) stepCombat(sim, 1 / 30, { autoFire: false });
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

  it('lets a manually controlled tank fire its direct missile along the 3D aim ray at an aircraft', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, -20, -20, 'Player Tank');
    const vulture = spawnVultureAt(sim, hf, -20, 36, 'Air Target', 2);
    vulture.weapon = undefined;
    vulture.weapons = undefined;
    tank.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    tank.turret!.yaw = 0;

    expect(manualFireAt(sim, tank, vulture.transform.x, vulture.transform.z, 'primary', vulture.transform.y)).toBe(true);

    const projectile = sim.projectiles.at(-1);
    expect(projectile?.directTargetId).toBe(vulture.id);
    expect(projectile?.homing).toBeUndefined();
    expect(projectile?.toY).toBe(vulture.transform.y);
    for (let i = 0; i < 30 * 2; i++) stepCombat(sim, 1 / 30, { autoFire: false });
    expect(vulture.health?.current).toBeLessThan(vulture.health?.max ?? 0);
    expect(sim.events.some((event) => event.kind === 'tankMissile-impact' && event.targetId === vulture.id)).toBe(true);
  });

  it('turns a locked primary tank missile into a homing shot that follows a moving target', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, -20, -20, 'Player Tank');
    const target = spawnTankAt(sim, -20, 42, 'Moving Target', 2);
    tank.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    tank.turret!.yaw = 0;
    target.weapon = undefined;
    target.weapons = undefined;

    expect(manualFireAt(sim, tank, target.transform.x, target.transform.z, 'primary', target.transform.y, target.id)).toBe(true);

    const projectile = sim.projectiles.at(-1);
    expect(projectile?.trajectory).toBe('homing');
    expect(projectile?.homing?.targetId).toBe(target.id);
    expect(projectile?.homing?.fizzleRange).toBeGreaterThan(sim.nav.size);
    expect(projectile?.speed).toBeCloseTo(WEAPONS.tankMissile.projectile!.speed * 0.68, 8);
    expect(projectile?.damageScale).toBeCloseTo(0.96, 8);
    expect(projectile?.forceScale).toBeCloseTo(0.72, 8);
    expect(projectile?.impactScale).toBeCloseTo(0.9, 8);
    target.transform.x += 18;
    target.previousTransform.x = target.transform.x;
    for (let i = 0; i < 30 * 3; i++) stepCombat(sim, 1 / 30, { autoFire: false });

    expect(target.health?.current).toBeLessThan(target.health?.max ?? 0);
    expect(sim.events.some((event) => event.kind === 'tankMissile-impact' && event.targetId === target.id)).toBe(true);
  });

  it('lands the current M-17 secondary lock on the enemy tank hull instead of the terrain beneath it', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const tank = spawnCurrentTankAt(sim, -50, 0, 'Player M-17');
    const target = spawnCurrentTankAt(sim, 50, 0, 'Enemy M-17', 2);
    tank.transform.y = sampleHeight(hf, tank.transform.x, tank.transform.z);
    tank.previousTransform.y = tank.transform.y;
    target.transform.y = sampleHeight(hf, target.transform.x, target.transform.z);
    target.previousTransform.y = target.transform.y;
    tank.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    tank.turret!.yaw = Math.PI / 2;
    target.weapon = undefined;
    target.weapons = undefined;

    expect(manualFireAt(
      sim,
      tank,
      target.transform.x,
      target.transform.z,
      'secondary',
      target.transform.y,
      target.id,
    )).toBe(true);
    expect(sim.projectiles.at(-1)?.weaponKind).toBe('tankMissile');
    expect(sim.projectiles.at(-1)?.homing?.targetId).toBe(target.id);
    const maxHealth = target.health!.max;
    for (let i = 0; i < 30 * 4; i++) stepCombat(sim, 1 / 30, { autoFire: false });

    expect(target.health?.current).toBeLessThan(maxHealth);
    const impact = sim.events.find((event) => event.kind === 'tankMissile-impact' && event.targetId === target.id);
    expect(impact?.targetType).toBe('tank');
    expect(impact?.toY).toBeGreaterThan((target.transform.y ?? 0) + 1);
  });

  it('limits locked missile steering so a fast aircraft can break pursuit', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, -20, -20, 'Player Tank');
    const wasp = spawnWaspAt(sim, hf, -20, 70, 'Evading Wasp', 2);
    tank.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    tank.turret!.yaw = 0;
    wasp.weapon = undefined;
    wasp.weapons = undefined;

    expect(manualFireAt(sim, tank, wasp.transform.x, wasp.transform.z, 'primary', wasp.transform.y, wasp.id)).toBe(true);
    const missile = sim.projectiles.at(-1)!;
    const initialDirectionX = missile.homing!.directionX;
    wasp.transform.x += 40;
    wasp.previousTransform.x = wasp.transform.x;
    stepCombat(sim, 1 / 30, { autoFire: false });

    expect(missile.homing!.directionX).toBeGreaterThan(initialDirectionX);
    expect(missile.homing!.directionX).toBeLessThan(0.1);

    const maxHealth = wasp.health!.max;
    for (let i = 0; i < 30 * 7; i++) {
      wasp.transform.x += 60 / 30;
      wasp.previousTransform.x = wasp.transform.x;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    expect(wasp.health?.current).toBe(maxHealth);
    expect(sim.projectiles).toHaveLength(0);
  });

  it('keeps a locked air-to-air missile in pursuit instead of detonating on terrain', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const wasp = spawnCurrentWaspAt(sim, hf, -50, 0, 'Player Wasp', 1);
    const hammerhead = spawnCurrentHammerheadAt(sim, hf, 50, 0, 'Enemy Hammerhead', 2);
    wasp.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2, climb: 0 };
    wasp.turret!.yaw = Math.PI / 2;
    hammerhead.weapon = undefined;
    hammerhead.weapons = undefined;

    expect(manualFireAt(
      sim,
      wasp,
      hammerhead.transform.x,
      hammerhead.transform.z,
      'secondary',
      hammerhead.transform.y,
      hammerhead.id,
    )).toBe(true);
    const missile = sim.projectiles.at(-1)!;
    expect(missile.weaponKind).toBe('aaMissile');
    expect(missile.homing?.targetId).toBe(hammerhead.id);

    // Reproduce the low-flight condition that previously converted a valid
    // aircraft lock into a premature ground explosion.
    missile.y = sampleHeight(hf, missile.x ?? missile.fromX, missile.z ?? missile.fromZ) + 0.1;
    const maxHealth = hammerhead.health!.max;
    stepCombat(sim, 1 / 30, { autoFire: false });
    expect(sim.projectiles).toContain(missile);
    expect(missile.y).toBeGreaterThan(
      sampleHeight(hf, missile.x ?? missile.fromX, missile.z ?? missile.fromZ) + 0.35,
    );
    for (let i = 0; i < 30 * 4; i++) stepCombat(sim, 1 / 30, { autoFire: false });

    expect(hammerhead.health?.current).toBeLessThan(maxHealth);
    const impact = sim.events.find((event) => event.kind === 'aaMissile-impact' && event.targetId === hammerhead.id);
    expect(impact?.targetType).toBe('aircraft');
    expect(impact?.toY).toBeCloseTo(hammerhead.transform.y ?? 0, 5);
  });

  it('gives the premium Hammerhead a working air-to-air lock and terminal hit', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const hammerhead = spawnCurrentHammerheadAt(sim, hf, -55, 0, 'Player Hammerhead', 1);
    const enemyWasp = spawnCurrentWaspAt(sim, hf, 55, 0, 'Enemy Wasp', 2);
    hammerhead.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2, climb: 0 };
    hammerhead.turret!.yaw = Math.PI / 2;
    enemyWasp.weapon = undefined;
    enemyWasp.weapons = undefined;

    expect(hammerhead.weapons?.primary.kind).toBe('agMissile');
    expect(canManualWeaponLockTarget(hammerhead.weapons?.primary.kind, enemyWasp)).toBe(true);
    expect(manualFireAt(
      sim,
      hammerhead,
      enemyWasp.transform.x,
      enemyWasp.transform.z,
      'primary',
      enemyWasp.transform.y,
      enemyWasp.id,
    )).toBe(true);

    const missile = sim.projectiles.at(-1)!;
    expect(missile.weaponKind).toBe('agMissile');
    expect(missile.homing?.targetId).toBe(enemyWasp.id);
    const maxHealth = enemyWasp.health!.max;
    for (let i = 0; i < 30 * 5; i++) stepCombat(sim, 1 / 30, { autoFire: false });

    expect(enemyWasp.health?.current).toBeLessThan(maxHealth);
    const impact = sim.events.find((event) => event.kind === 'agMissile-impact' && event.targetId === enemyWasp.id);
    expect(impact?.targetType).toBe('aircraft');
    expect(impact?.toY).toBeCloseTo(enemyWasp.transform.y ?? 0, 5);
  });

  it('lets missile infantry lock a moving vehicle with its primary rocket', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const rockets = spawnInfantryAt(sim, -20, -20, 1, 'rocket-infantry');
    const target = spawnTankAt(sim, -20, 42, 'Moving Target', 2);
    rockets.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    rockets.turret!.yaw = 0;
    target.weapon = undefined;
    target.weapons = undefined;

    expect(isManualTargetLockWeapon(rockets.weapons?.primary.kind)).toBe(true);
    expect(manualFireAt(sim, rockets, target.transform.x, target.transform.z, 'primary', target.transform.y, target.id)).toBe(true);
    expect(sim.projectiles.at(-1)?.homing?.targetId).toBe(target.id);
    target.transform.x += 12;
    target.previousTransform.x = target.transform.x;
    for (let i = 0; i < 30 * 3; i++) stepCombat(sim, 1 / 30, { autoFire: false });

    expect(target.health?.current).toBeLessThan(target.health?.max ?? 0);
  });

  it('keeps Vulture rocket pods unguided even when a target id is supplied', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -20, -20, 'Vulture');
    const target = spawnTankAt(sim, -20, 58, 'Moving Target', 2);
    vulture.playerControlled = { throttle: 0, turn: 0, aimYaw: 0, climb: 0 };
    vulture.turret!.yaw = 0;
    target.weapon = undefined;
    target.weapons = undefined;

    expect(isManualTargetLockWeapon(vulture.weapons?.primary.kind)).toBe(false);
    expect(manualFireAt(sim, vulture, target.transform.x, target.transform.z, 'primary', target.transform.y, target.id)).toBe(true);
    const projectile = sim.projectiles.at(-1);
    expect(projectile?.weaponKind).toBe('rocketPod');
    expect(projectile?.trajectory).toBe('flat');
    expect(projectile?.homing).toBeUndefined();
  });

  it('lets a player lock and manually intercept a hostile strategic missile', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    sim.rules.autoDefense = false;
    const hammerhead = spawnHammerheadAt(sim, hf, 0, 0, 'Interceptor', 1);
    hammerhead.playerControlled = { throttle: 0, turn: 0, aimYaw: 0, climb: 0 };
    hammerhead.turret!.yaw = 0;
    const strategicId = 9001;
    const strategic = {
      kind: 'siegeMissile' as const,
      weaponKind: 'strategicMissile',
      fromX: 0,
      fromY: 20,
      fromZ: 60,
      x: 0,
      y: 20,
      z: 60,
      toX: 0,
      toY: 1,
      toZ: -120,
      elapsed: 0,
      duration: 8,
      teamId: 2,
      attackerId: 99,
      strategic: true,
      strategicId,
      strategicTargetTeamId: 2,
      strategicHealth: 100,
      strategicMaxHealth: 100,
    };
    sim.projectiles.push(strategic);

    expect(canManualWeaponLockStrategic(hammerhead.weapon?.kind, strategic)).toBe(true);
    expect(manualFireAt(sim, hammerhead, 0, 60, 'primary', 20, undefined, strategicId)).toBe(true);
    expect(sim.projectiles.some((projectile) => projectile.strategicInterceptor?.targetStrategicId === strategicId)).toBe(true);

    settle(sim, 1);
    expect(strategic.strategicHealth).toBe(90);
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
    expect(sim.events.some((event) => event.kind === 'tankBomb-impact')).toBe(true);
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

  it('fortress guard towers mount a possessable missile rack and automatically defend their base', () => {
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
    expect(tower?.weapon?.kind).toBe('siegeMissile');
    expect(tower?.weapon?.salvoCount).toBe(1);
    expect(tower?.weapons?.secondary?.kind).toBe('tankBomb');
    expect(tower?.weapons?.secondary?.salvoCount).toBe(4);
    expect(tower?.specialWeapon?.kind).toBe('annihilatorMissile');
    expect(tower?.possessable?.socketHeight).toBeGreaterThan(12);
    expect(tower?.mover).toBeUndefined();
    expect(tower?.transform.y).toBeTypeOf('number');

    const enemy = spawnTankAt(sim, tower!.transform.x + 34, tower!.transform.z, 'Raider', 2);
    settle(sim, 4);

    expect(enemy.health?.current).toBeLessThan(100);
    expect(sim.events.some((event) => event.kind === 'siegeMissile')).toBe(true);
    expect(sim.events.some((event) => event.kind === 'tankBomb' && event.sourceTeamId === 1)).toBe(false);
  });

  it('gives autonomous unguided defense towers a bounded lead on moving targets', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);
    economy.readyStructure = 'guard-tower';
    const tower = placeStructure(
      sim,
      hf,
      economy,
      updatePlacement(sim, hf, 'guard-tower', base.transform.x + 26, base.transform.z, 1, economy),
    )!;
    const target = spawnTankAt(sim, tower.transform.x + 86, tower.transform.z, 'Moving Raider', 2);
    target.velocity = { x: 0, z: 10 };

    const aim = predictiveDefenseTowerAimPoint(sim, tower, tower.weapons!.primary, target);

    expect(aim.x).toBeCloseTo(target.transform.x);
    expect(aim.z).toBeGreaterThan(target.transform.z + 4);
    expect(aim.leadSeconds).toBeGreaterThan(0.4);
    expect(aim.leadSeconds).toBeLessThanOrEqual(1.9);
    expect(predictiveDefenseTowerAimPoint(sim, tower, tower.weapons!.primary, target)).toEqual(aim);

    tower.turret!.yaw = Math.atan2(aim.x - tower.transform.x, aim.z - tower.transform.z);
    tower.weapons!.secondary!.cooldown = 99;
    stepCombat(sim, 1 / 30);
    const fired = sim.projectiles.find((projectile) => projectile.weaponKind === 'siegeMissile');
    expect(fired?.directTargetId).toBe(target.id);
    expect(fired?.toZ).toBeCloseTo(aim.z);
  });

  it('does not pre-lead player-controlled towers or autonomous homing missiles', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);
    economy.readyStructure = 'aa-tower';
    const tower = placeStructure(
      sim,
      hf,
      economy,
      updatePlacement(sim, hf, 'aa-tower', base.transform.x + 26, base.transform.z, 1, economy),
    )!;
    const target = spawnWaspAt(sim, hf, tower.transform.x + 90, tower.transform.z, 'Crossing Wasp', 2);
    target.velocity = { x: 0, z: 18 };

    const homingAim = predictiveDefenseTowerAimPoint(sim, tower, tower.weapons!.primary, target);
    expect(homingAim).toEqual({ x: target.transform.x, z: target.transform.z, leadSeconds: 0 });

    tower.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    const manualAim = predictiveDefenseTowerAimPoint(sim, tower, tower.weapons!.secondary!, target);
    expect(manualAim).toEqual({ x: target.transform.x, z: target.transform.z, leadSeconds: 0 });
  });

  it('AA towers expose fortress control with lock-guided air defense and ground missiles', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    economy.readyStructure = 'aa-tower';
    const placement = updatePlacement(sim, hf, 'aa-tower', base.transform.x + 26, base.transform.z, 1, economy);
    const tower = placeStructure(sim, hf, economy, placement);

    expect(tower?.weapon?.kind).toBe('aaMissile');
    expect(tower?.weapons?.secondary?.kind).toBe('swarmRocket');
    expect(tower?.specialWeapon?.kind).toBe('annihilatorMissile');
    expect(tower?.possessable?.socketHeight).toBeGreaterThan(12);
    expect(tower?.turret?.turnRate).toBeGreaterThan(3);
    expect(tower?.vision?.radius).toBe(300);
  });

  it('launches homing missiles from explicit locks on both fortress tower types', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5200);
    const base = createInitialBase(sim, hf, economy);

    economy.readyStructure = 'guard-tower';
    const guard = placeStructure(
      sim,
      hf,
      economy,
      updatePlacement(sim, hf, 'guard-tower', base.transform.x + 26, base.transform.z, 1, economy),
    )!;
    economy.readyStructure = 'aa-tower';
    const aa = placeStructure(
      sim,
      hf,
      economy,
      updatePlacement(sim, hf, 'aa-tower', base.transform.x - 26, base.transform.z, 1, economy),
    )!;
    const tank = spawnTankAt(sim, guard.transform.x + 90, guard.transform.z, 'Locked Armor', 2);
    const aircraft = spawnWaspAt(sim, hf, aa.transform.x - 90, aa.transform.z, 'Locked Aircraft', 2);

    guard.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    guard.turret!.yaw = Math.PI / 2;
    expect(manualFireAt(sim, guard, tank.transform.x, tank.transform.z, 'primary', tank.transform.y, tank.id)).toBe(true);
    expect(sim.projectiles.at(-1)?.homing?.targetId).toBe(tank.id);

    aa.playerControlled = { throttle: 0, turn: 0, aimYaw: -Math.PI / 2 };
    aa.turret!.yaw = -Math.PI / 2;
    expect(manualFireAt(sim, aa, aircraft.transform.x, aircraft.transform.z, 'primary', aircraft.transform.y, aircraft.id)).toBe(true);
    expect(sim.projectiles.at(-1)?.homing?.targetId).toBe(aircraft.id);
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

  it('does not auto-engage aircraft beyond the shooter vision', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    // Rocket teams can see across their entire missile envelope.
    const rockets = spawnInfantryAt(sim, 0, 0, 1, 'rocket-infantry');
    const visionRadius = rockets.vision?.radius ?? 0;
    expect(visionRadius).toBeGreaterThanOrEqual(WEAPONS.aaMissile.airRange ?? WEAPONS.aaMissile.range);
    const distance = visionRadius + 20;
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
