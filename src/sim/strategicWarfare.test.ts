import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import type { Entity } from './components';
import { stepCombat } from './combat';
import { canBuildStructure, createEconomy, createInitialBase, recomputePower, upgradeStrategicMissile } from './economy';
import { generateHeightfield } from './heightfield';
import {
  discoverEnemyStructures,
  launchBlindStrategicMissile,
  launchStrategicMissile,
  purchaseEnemyIntelligence,
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

  it('buys intelligence by enemy and category instead of revealing every base globally', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5000, 'missile-command');
    createInitialBase(sim, hf, economy, -180, 0);
    addStructure(sim, 'intelligence-center', 1, -150, 0);
    const army2Power = addStructure(sim, 'power-plant', 2, 20, 0);
    const army2Factory = addStructure(sim, 'factory', 2, 40, 0);
    const army3Power = addStructure(sim, 'power-plant', 3, 60, 0);
    const known = new Set<number>();

    expect(purchaseEnemyIntelligence(sim, economy, 2, 'power').ok).toBe(true);
    discoverEnemyStructures(sim, economy, known);
    expect(known.has(army2Power.id)).toBe(true);
    expect(known.has(army2Factory.id)).toBe(false);
    expect(known.has(army3Power.id)).toBe(false);

    expect(purchaseEnemyIntelligence(sim, economy, 2, 'military').ok).toBe(true);
    discoverEnemyStructures(sim, economy, known);
    expect(known.has(army2Factory.id)).toBe(true);
    expect(known.has(army3Power.id)).toBe(false);
  });

  it('allows a blind launch toward a chosen army and warns that defender immediately', () => {
    const { sim, economy } = missileFixture();
    expect(launchBlindStrategicMissile(sim, economy, 2).ok).toBe(true);
    expect(sim.projectiles[0]).toMatchObject({ strategic: true, directTargetId: undefined });
    expect(sim.events.some((event) => event.kind === 'strategic-missile-warning' && event.targetTeamId === 2)).toBe(true);
  });

  it('launches only at identified targets and charges the missile cost', () => {
    const { sim, economy, target } = missileFixture();
    const creditsBefore = economy.credits;

    expect(launchStrategicMissile(sim, economy, new Set(), target.id)).toEqual({
      ok: false,
      reason: 'Target has not been identified',
    });
    economy.intelligenceByTeam[2] = ['military'];
    const result = launchStrategicMissile(sim, economy, new Set([target.id]), target.id);
    expect(result.ok).toBe(true);
    expect(economy.credits).toBe(creditsBefore - STRATEGIC_MISSILE_COST);
    expect(economy.strategicMissileCooldown).toBe(STRATEGIC_MISSILE_COOLDOWN);
    expect(sim.projectiles).toHaveLength(1);
    expect(sim.projectiles[0]).toMatchObject({ strategic: true, weaponKind: 'strategicMissile', trajectory: 'arc' });
    expect(sim.projectiles[0].directTargetId).toBeUndefined();
    expect(Math.hypot(sim.projectiles[0].toX - target.transform.x, sim.projectiles[0].toZ - target.transform.z)).toBeLessThanOrEqual(55);
  });

  it('becomes pinpoint after three intelligence programs and reaches the selected structure', () => {
    const { sim, economy, target } = missileFixture();
    economy.intelligenceByTeam[2] = ['economy', 'power', 'military'];
    const healthBefore = target.health!.current;
    expect(launchStrategicMissile(sim, economy, new Set([target.id]), target.id).ok).toBe(true);
    expect(sim.projectiles[0]).toMatchObject({
      toX: target.transform.x,
      toZ: target.transform.z,
      directTargetId: target.id,
      trajectory: 'arc',
    });

    for (let tick = 0; tick < 30 * 20 && sim.projectiles.length > 0; tick++) {
      sim.tick++;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    expect(sim.projectiles).toHaveLength(0);
    expect(target.health!.current / healthBefore).toBeLessThan(0.2);
    expect(sim.events.some((event) =>
      event.kind === 'siegeMissile-impact' &&
      event.weaponKind === 'strategicMissile' &&
      event.damage >= 500 &&
      event.impactScale === 1.6
    )).toBe(true);
  });

  it('upgrades the silo warhead independently from intelligence', () => {
    const { sim, economy, target } = missileFixture();
    economy.intelligenceByTeam[2] = ['military'];
    const creditsBefore = economy.credits;
    expect(upgradeStrategicMissile(sim, economy)).toBe(true);
    expect(economy.strategicMissileLevel).toBe(2);
    expect(economy.credits).toBe(creditsBefore - 500);
    expect(launchStrategicMissile(sim, economy, new Set([target.id]), target.id).ok).toBe(true);
    expect(sim.projectiles[0]).toMatchObject({ damageScale: 1.75, impactScale: 2.25 });
  });

  it('makes a fully upgraded warhead devastating to a locked building target', () => {
    const { sim, economy, target } = missileFixture();
    economy.intelligenceByTeam[2] = ['economy', 'power', 'military'];
    economy.strategicMissileLevel = 3;
    expect(launchStrategicMissile(sim, economy, new Set([target.id]), target.id).ok).toBe(true);
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
    economy.intelligenceByTeam[2] = ['military'];
    addStructure(sim, 'missile-defense', 2, -135, 14);
    const healthBefore = target.health!.current;
    expect(launchStrategicMissile(sim, economy, new Set([target.id]), target.id).ok).toBe(true);

    for (let tick = 0; tick < 30 && sim.projectiles.length > 0; tick++) {
      sim.tick++;
      stepCombat(sim, 1 / 30, { autoFire: false });
    }

    expect(sim.projectiles).toHaveLength(0);
    expect(sim.events.some((event) => event.kind === 'strategic-missile-intercepted')).toBe(true);
    expect(target.health?.current).toBe(healthBefore);
  });
});
