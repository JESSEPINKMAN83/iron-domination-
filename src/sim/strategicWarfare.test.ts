import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import type { Entity } from './components';
import { stepCombat } from './combat';
import { canBuildStructure, createEconomy, createInitialBase, recomputePower } from './economy';
import { generateHeightfield } from './heightfield';
import {
  discoverEnemyStructures,
  launchStrategicMissile,
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

  it('reveals two, then five, then every enemy structure as intelligence improves', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const economy = createEconomy(1, 5000, 'missile-command');
    createInitialBase(sim, hf, economy, -180, 0);
    addStructure(sim, 'intelligence-center', 1, -150, 0);
    for (let index = 0; index < 7; index++) addStructure(sim, 'wall', 2, 20 + index * 18, 0);
    const known = new Set<number>();

    discoverEnemyStructures(sim, economy, known);
    expect(known.size).toBe(2);
    economy.intelligenceLevel = 2;
    discoverEnemyStructures(sim, economy, known);
    expect(known.size).toBe(5);
    economy.intelligenceLevel = 3;
    discoverEnemyStructures(sim, economy, known);
    expect(known.size).toBe(7);
  });

  it('launches only at identified targets and charges the missile cost', () => {
    const { sim, economy, target } = missileFixture();
    const creditsBefore = economy.credits;

    expect(launchStrategicMissile(sim, economy, new Set(), target.id)).toEqual({
      ok: false,
      reason: 'Target has not been identified',
    });
    const result = launchStrategicMissile(sim, economy, new Set([target.id]), target.id);
    expect(result.ok).toBe(true);
    expect(economy.credits).toBe(creditsBefore - STRATEGIC_MISSILE_COST);
    expect(economy.strategicMissileCooldown).toBe(STRATEGIC_MISSILE_COOLDOWN);
    expect(sim.projectiles).toHaveLength(1);
    expect(sim.projectiles[0]).toMatchObject({ strategic: true, weaponKind: 'strategicMissile', trajectory: 'arc' });
    expect(sim.projectiles[0].directTargetId).toBeUndefined();
    expect(Math.hypot(sim.projectiles[0].toX - target.transform.x, sim.projectiles[0].toZ - target.transform.z)).toBeLessThanOrEqual(48);
  });

  it('becomes pinpoint at intelligence level 3 and reaches the selected structure', () => {
    const { sim, economy, target } = missileFixture();
    economy.intelligenceLevel = 3;
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
    expect(target.health!.current).toBeLessThan(healthBefore);
  });

  it('lets a hostile missile-defense battery destroy the round before impact', () => {
    const { sim, economy, target } = missileFixture();
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
