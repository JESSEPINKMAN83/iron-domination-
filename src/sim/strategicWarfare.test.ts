import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import type { Entity } from './components';
import { stepCombat } from './combat';
import { canBuildStructure, createEconomy, createInitialBase, recomputePower, upgradeStrategicAccuracy, upgradeStrategicMissile } from './economy';
import { generateHeightfield, type Heightfield } from './heightfield';
import {
  EMBER_DRONE_COOLDOWN,
  EMBER_DRONE_COST,
  EMBER_DRONE_HEALTH,
  EMBER_DRONE_MAX_IN_FLIGHT,
  emberLaunchReadiness,
  launchEmberDroneAt,
  launchStrategicMissileAt,
  strategicAccuracy,
  STRATEGIC_MISSILE_COOLDOWN,
  STRATEGIC_MISSILE_COST,
} from './strategicWarfare';
import { createGameSim, spawnWaspAt, type GameSim } from './world';

function addStructure(sim: GameSim, kind: StructureKind, team: number, x: number, z: number): Entity {
  const def = STRUCTURES[kind];
  return sim.world.add({
    id: sim.nextEntityId++,
    name: def.label,
    transform: { x, z, rot: 0 },
    previousTransform: { x, z, rot: 0 },
    health: { current: def.health ?? 630, max: def.health ?? 630 },
    team: { id: team },
    selectable: { selected: false, type: 'building', radius: Math.max(def.footprint.w, def.footprint.h) },
    collider: { radius: Math.max(def.footprint.w, def.footprint.h) },
    armor: { kind: 'building' },
    building: {
      kind,
      label: def.label,
      footprint: def.footprint,
      powerProduced: def.powerProduced,
      powerUsed: def.powerUsed,
      complete: true,
      buildProgress: 1,
    },
  });
}

function missileFixture(): {
  sim: GameSim;
  economy: ReturnType<typeof createEconomy>;
  target: Entity;
  hf: Heightfield;
} {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const economy = createEconomy(1, 5000, 'missile-command');
  createInitialBase(sim, hf, economy, -180, 0);
  addStructure(sim, 'power-plant', 1, -165, 0);
  addStructure(sim, 'intelligence-center', 1, -150, -12);
  addStructure(sim, 'strategic-silo', 1, -145, 14);
  createInitialBase(sim, hf, createEconomy(2, 5000), 180, 0);
  const target = addStructure(sim, 'factory', 2, 170, 0);
  recomputePower(sim, economy);
  return { sim, economy, target, hf };
}

describe('Missile Command strategic warfare', () => {
  it('keeps specialist structures exclusive to the selected doctrine', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const standard = createEconomy(1, 5000, 'iron-legion');
    createInitialBase(sim, hf, standard);
    addStructure(sim, 'power-plant', 1, -20, 0);
    expect(canBuildStructure(sim, standard, 'intelligence-center')).toEqual({
      ok: false,
      reason: 'Vesper Republic only',
    });

    const specialist = createEconomy(2, 5000, 'missile-command');
    createInitialBase(sim, hf, specialist);
    addStructure(sim, 'power-plant', 2, 20, 0);
    expect(canBuildStructure(sim, specialist, 'intelligence-center').ok).toBe(true);
    expect(canBuildStructure(sim, specialist, 'skylance-ciws')).toEqual({
      ok: false,
      reason: 'Aegis Coalition only',
    });
    expect(canBuildStructure(sim, standard, 'skylance-ciws').ok).toBe(true);
  });

  it('launches a visible low-flying Ember drone from an Intelligence Center', () => {
    const { sim, economy, target } = missileFixture();
    const creditsBefore = economy.credits;
    const result = launchEmberDroneAt(sim, economy, 2, target.transform.x, target.transform.z);

    expect(result.ok).toBe(true);
    expect(economy.credits).toBe(creditsBefore - EMBER_DRONE_COST);
    expect(economy.emberDroneCooldown).toBe(EMBER_DRONE_COOLDOWN);
    expect(sim.projectiles[0]).toMatchObject({
      strategic: true,
      strategicProfile: 'drone',
      weaponKind: 'emberDrone',
      trajectory: 'flat',
      strategicHealth: EMBER_DRONE_HEALTH,
      strategicMaxHealth: EMBER_DRONE_HEALTH,
    });
    expect(sim.events.some((event) => event.kind === 'ember-drone-warning' && event.targetTeamId === 2)).toBe(true);
    expect(Math.hypot(sim.projectiles[0].toX - target.transform.x, sim.projectiles[0].toZ - target.transform.z)).toBeLessThanOrEqual(10);
  });

  it('caps Ember saturation at six airborne drones', () => {
    const { sim, economy, target } = missileFixture();
    for (let index = 0; index < EMBER_DRONE_MAX_IN_FLIGHT; index++) {
      economy.emberDroneCooldown = 0;
      sim.tick++;
      expect(launchEmberDroneAt(sim, economy, 2, target.transform.x, target.transform.z).ok).toBe(true);
    }
    economy.emberDroneCooldown = 0;
    expect(emberLaunchReadiness(sim, economy)).toMatchObject({ ready: false, inFlight: 6 });
    expect(launchEmberDroneAt(sim, economy, 2, target.transform.x, target.transform.z)).toMatchObject({
      ok: false,
      reason: 'Six drones already airborne',
    });
  });

  it('lets Skylance destroy an Ember but keeps the ballistic battery out of the exchange', () => {
    const { sim, economy, target } = missileFixture();
    addStructure(sim, 'skylance-ciws', 2, 135, 14);
    addStructure(sim, 'missile-defense', 2, 135, -14);
    const healthBefore = target.health!.current;
    expect(launchEmberDroneAt(sim, economy, 2, target.transform.x, target.transform.z).ok).toBe(true);

    for (let tick = 0; tick < 30 * 20 && !sim.events.some((event) => event.kind === 'strategic-missile-intercepted'); tick++) {
      sim.tick++;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    const bursts = sim.events.filter((event) => event.kind === 'skylanceGun' && event.strategicId !== undefined);
    expect(bursts).toHaveLength(4);
    expect(bursts.at(-1)).toMatchObject({ killed: true, targetHealth: 0, targetMaxHealth: EMBER_DRONE_HEALTH });
    expect(sim.events.some((event) => event.kind === 'aaMissile-impact' && event.targetLabel === 'Ember drone')).toBe(false);
    expect(target.health?.current).toBe(healthBefore);
  });

  it('upgrades guidance independently and shrinks the visible scatter radius', () => {
    const { sim, economy } = missileFixture();
    expect(strategicAccuracy(economy.strategicAccuracyLevel).radius).toBe(110);
    expect(upgradeStrategicAccuracy(sim, economy)).toBe(true);
    expect(strategicAccuracy(economy.strategicAccuracyLevel).radius).toBe(55);
    expect(upgradeStrategicAccuracy(sim, economy)).toBe(true);
    expect(strategicAccuracy(economy.strategicAccuracyLevel).radius).toBe(22);
    expect(upgradeStrategicAccuracy(sim, economy)).toBe(true);
    expect(strategicAccuracy(economy.strategicAccuracyLevel).radius).toBe(0);
  });

  it('allows a marked-area launch and warns the chosen defender immediately', () => {
    const { sim, economy } = missileFixture();
    expect(launchStrategicMissileAt(sim, economy, 2, 170, 0).ok).toBe(true);
    expect(sim.projectiles[0]).toMatchObject({ strategic: true, directTargetId: undefined });
    expect(sim.events.some((event) => event.kind === 'strategic-missile-warning' && event.targetTeamId === 2)).toBe(true);
  });

  it('lands somewhere inside the marked scatter circle and charges the missile cost', () => {
    const { sim, economy, target } = missileFixture();
    const creditsBefore = economy.credits;

    const result = launchStrategicMissileAt(sim, economy, 2, target.transform.x, target.transform.z);
    expect(result.ok).toBe(true);
    expect(economy.credits).toBe(creditsBefore - STRATEGIC_MISSILE_COST);
    expect(economy.strategicMissileCooldown).toBe(STRATEGIC_MISSILE_COOLDOWN);
    expect(sim.projectiles).toHaveLength(1);
    expect(sim.projectiles[0]).toMatchObject({ strategic: true, weaponKind: 'strategicMissile', trajectory: 'arc' });
    expect(sim.projectiles[0].directTargetId).toBeUndefined();
    expect(Math.hypot(sim.projectiles[0].toX - target.transform.x, sim.projectiles[0].toZ - target.transform.z)).toBeLessThanOrEqual(110);
  });

  it('becomes pinpoint after three accuracy upgrades and reaches the marked location', () => {
    const { sim, economy, target } = missileFixture();
    economy.strategicAccuracyLevel = 3;
    const healthBefore = target.health!.current;
    expect(launchStrategicMissileAt(sim, economy, 2, target.transform.x, target.transform.z).ok).toBe(true);
    expect(sim.projectiles[0]).toMatchObject({
      toX: target.transform.x,
      toZ: target.transform.z,
      trajectory: 'arc',
    });

    for (let tick = 0; tick < 30 * 20 && sim.projectiles.length > 0; tick++) {
      sim.tick++;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    expect(sim.projectiles).toHaveLength(0);
    expect(target.health!.current / healthBefore).toBeLessThan(0.6);
    expect(sim.events.some((event) =>
      event.kind === 'siegeMissile-impact' &&
      event.weaponKind === 'strategicMissile' &&
      event.damage >= 250 &&
      event.impactScale === 1.6
    )).toBe(true);
  });

  it('upgrades the silo warhead independently from accuracy', () => {
    const { sim, economy, target } = missileFixture();
    const creditsBefore = economy.credits;
    expect(upgradeStrategicMissile(sim, economy)).toBe(true);
    expect(economy.strategicMissileLevel).toBe(2);
    expect(economy.credits).toBe(creditsBefore - 500);
    expect(launchStrategicMissileAt(sim, economy, 2, target.transform.x, target.transform.z).ok).toBe(true);
    expect(sim.projectiles[0]).toMatchObject({ damageScale: 1.75, impactScale: 2.25, strategicHealth: 140, strategicMaxHealth: 140 });
  });

  it('makes a fully upgraded warhead devastating at the marked point', () => {
    const { sim, economy, target } = missileFixture();
    economy.strategicAccuracyLevel = 3;
    economy.strategicMissileLevel = 3;
    expect(launchStrategicMissileAt(sim, economy, 2, target.transform.x, target.transform.z).ok).toBe(true);
    expect(sim.projectiles[0]).toMatchObject({ damageScale: 2.8, impactScale: 3.1 });

    for (let tick = 0; tick < 30 * 20 && sim.projectiles.length > 0; tick++) {
      sim.tick++;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    expect(target.health?.current).toBe(0);
    expect(target.destroyed).toBeDefined();
  });

  it('requires five missile-defense hits to destroy a standard strategic round', () => {
    const { sim, economy, target } = missileFixture();
    economy.strategicAccuracyLevel = 3;
    addStructure(sim, 'missile-defense', 2, 135, 14);
    const healthBefore = target.health!.current;
    expect(launchStrategicMissileAt(sim, economy, 2, target.transform.x, target.transform.z).ok).toBe(true);
    expect(sim.projectiles.find((projectile) => projectile.strategic)).toMatchObject({ strategicHealth: 100, strategicMaxHealth: 100 });

    for (let tick = 0; tick < 30 * 20 && !sim.events.some((event) => event.kind === 'strategic-missile-intercepted'); tick++) {
      sim.tick++;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    const defenseHits = sim.events.filter((event) => event.kind === 'aaMissile-impact' && event.strategicId !== undefined);
    expect(defenseHits).toHaveLength(5);
    expect(defenseHits.slice(0, 4).every((event) => !event.killed)).toBe(true);
    expect(defenseHits[4]).toMatchObject({ killed: true, targetHealth: 0, targetMaxHealth: 100 });
    expect(sim.projectiles.find((projectile) => projectile.strategic)).toBeUndefined();
    expect(sim.events.some((event) => event.kind === 'strategic-missile-intercepted')).toBe(true);
    expect(target.health?.current).toBe(healthBefore);
  });

  it('lets defending interceptor aircraft damage an incoming strategic round', () => {
    const { sim, economy, target, hf } = missileFixture();
    economy.strategicAccuracyLevel = 3;
    const wasp = spawnWaspAt(sim, hf, 135, 8, 'Defense Wasp', 2);
    expect(launchStrategicMissileAt(sim, economy, 2, target.transform.x, target.transform.z).ok).toBe(true);

    for (let tick = 0; tick < 30 * 12 && !sim.events.some((event) => event.kind === 'aaMissile-impact' && event.sourceTeamId === 2); tick++) {
      sim.tick++;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    expect(sim.events.some((event) => event.kind === 'aaMissile' && event.sourceTeamId === 2 && event.targetLabel === 'Aircraft interceptor')).toBe(true);
    expect(sim.events.some((event) => event.kind === 'aaMissile-impact' && event.sourceTeamId === 2 && event.damage === 10)).toBe(true);
    expect(wasp.health?.current).toBe(wasp.health?.max);
  });
});
