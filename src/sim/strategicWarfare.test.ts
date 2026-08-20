import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import type { Entity } from './components';
import { stepCombat } from './combat';
import { canBuildStructure, createEconomy, createInitialBase, recomputePower, upgradeStrategicAccuracy, upgradeStrategicMissile } from './economy';
import { generateHeightfield } from './heightfield';
import {
  launchStrategicMissileAt,
  strategicAccuracy,
  STRATEGIC_MISSILE_COOLDOWN,
  STRATEGIC_MISSILE_COST,
} from './strategicWarfare';
import { createGameSim, type GameSim } from './world';

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
  return { sim, economy, target };
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
      reason: 'Missile Command doctrine only',
    });

    const specialist = createEconomy(2, 5000, 'missile-command');
    createInitialBase(sim, hf, specialist);
    addStructure(sim, 'power-plant', 2, 20, 0);
    expect(canBuildStructure(sim, specialist, 'intelligence-center').ok).toBe(true);
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
    expect(sim.projectiles[0]).toMatchObject({ damageScale: 1.75, impactScale: 2.25 });
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

  it('lets a hostile missile-defense battery destroy the round before impact', () => {
    const { sim, economy, target } = missileFixture();
    economy.strategicAccuracyLevel = 3;
    addStructure(sim, 'missile-defense', 2, -135, 14);
    const healthBefore = target.health!.current;
    expect(launchStrategicMissileAt(sim, economy, 2, target.transform.x, target.transform.z).ok).toBe(true);

    for (let tick = 0; tick < 30 && sim.projectiles.length > 0; tick++) {
      sim.tick++;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    expect(sim.projectiles).toHaveLength(0);
    expect(sim.events.some((event) => event.kind === 'strategic-missile-intercepted')).toBe(true);
    expect(target.health?.current).toBe(healthBefore);
  });
});
