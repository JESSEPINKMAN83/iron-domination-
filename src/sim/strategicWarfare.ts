import { WEAPONS } from '../content/phase4';
import type { Entity } from './components';
import { buildings, hasStructure, spendCredits, type EconomyState } from './economy';
import { sampleHeight } from './heightfield';
import { areTeamsHostile, entityById, type CombatEvent, type GameSim } from './world';

export const STRATEGIC_MISSILE_COST = 350;
export const STRATEGIC_MISSILE_COOLDOWN = 30;

export interface StrategicAccuracy {
  label: 'LOW' | 'MEDIUM' | 'PINPOINT';
  radius: number;
}

export interface StrategicLaunchResult {
  ok: boolean;
  reason: string;
  event?: CombatEvent;
}

export function intelligenceTargetCapacity(level: number): number {
  if (level <= 0) return 0;
  if (level === 1) return 2;
  if (level === 2) return 5;
  return Number.POSITIVE_INFINITY;
}

export function strategicAccuracy(level: number): StrategicAccuracy {
  if (level <= 1) return { label: 'LOW', radius: 48 };
  if (level === 2) return { label: 'MEDIUM', radius: 16 };
  return { label: 'PINPOINT', radius: 0 };
}

/**
 * Adds deterministic contacts to a persistent set. Level 1 finds the two
 * closest structures, level 2 expands to five, and level 3 tracks every live
 * enemy building (including structures completed later).
 */
export function discoverEnemyStructures(
  sim: GameSim,
  economy: EconomyState,
  knownTargetIds: Set<number>,
): Entity[] {
  if (!hasStructure(sim, 'intelligence-center', economy.team)) return [];
  const center = buildings(sim, economy.team).find(
    (entity) => entity.building?.kind === 'intelligence-center' && entity.building.complete && !entity.destroyed,
  );
  if (!center) return [];
  const capacity = intelligenceTargetCapacity(economy.intelligenceLevel);
  const candidates = buildings(sim)
    .filter((entity) =>
      !entity.destroyed &&
      entity.building?.complete &&
      entity.team?.id !== undefined &&
      areTeamsHostile(sim, economy.team, entity.team.id),
    )
    .sort((a, b) => {
      const distanceA = Math.hypot(a.transform.x - center.transform.x, a.transform.z - center.transform.z);
      const distanceB = Math.hypot(b.transform.x - center.transform.x, b.transform.z - center.transform.z);
      return distanceA - distanceB || a.id - b.id;
    });
  const newlyDiscovered: Entity[] = [];
  for (const target of candidates) {
    if (knownTargetIds.has(target.id)) continue;
    if (knownTargetIds.size >= capacity) break;
    knownTargetIds.add(target.id);
    newlyDiscovered.push(target);
  }
  return newlyDiscovered;
}

export function knownStrategicTargets(sim: GameSim, knownTargetIds: Set<number>): Entity[] {
  return Array.from(knownTargetIds)
    .map((id) => entityById(sim, id))
    .filter((entity): entity is Entity => !!entity?.building && !entity.destroyed && (entity.health?.current ?? 0) > 0)
    .sort((a, b) => a.id - b.id);
}

export function strategicLaunchReadiness(
  sim: GameSim,
  economy: EconomyState,
): { ready: boolean; reason: string; cooldown: number } {
  if (economy.doctrine !== 'missile-command') return { ready: false, reason: 'Missile Command doctrine only', cooldown: 0 };
  if (!hasStructure(sim, 'intelligence-center', economy.team)) return { ready: false, reason: 'Build an Intelligence Center', cooldown: 0 };
  if (!hasStructure(sim, 'strategic-silo', economy.team)) return { ready: false, reason: 'Build a Missile Silo', cooldown: 0 };
  if (economy.powerProduced < economy.powerUsed) return { ready: false, reason: 'Insufficient power', cooldown: economy.strategicMissileCooldown };
  if (economy.strategicMissileCooldown > 0) {
    return { ready: false, reason: `Reloading ${Math.ceil(economy.strategicMissileCooldown)}s`, cooldown: economy.strategicMissileCooldown };
  }
  if (economy.credits < STRATEGIC_MISSILE_COST) return { ready: false, reason: 'Insufficient credits', cooldown: 0 };
  return { ready: true, reason: '', cooldown: 0 };
}

export function launchStrategicMissile(
  sim: GameSim,
  economy: EconomyState,
  knownTargetIds: Set<number>,
  targetId: number,
): StrategicLaunchResult {
  const readiness = strategicLaunchReadiness(sim, economy);
  if (!readiness.ready) return { ok: false, reason: readiness.reason };
  if (!knownTargetIds.has(targetId)) return { ok: false, reason: 'Target has not been identified' };
  const target = entityById(sim, targetId);
  if (
    !target?.building || target.destroyed || !target.health || target.team?.id === undefined ||
    !areTeamsHostile(sim, economy.team, target.team.id)
  ) return { ok: false, reason: 'Target no longer available' };
  const silo = buildings(sim, economy.team).find(
    (entity) => entity.building?.kind === 'strategic-silo' && entity.building.complete && !entity.destroyed,
  );
  if (!silo) return { ok: false, reason: 'No operational silo' };
  if (!spendCredits(economy, sim.tick, 'Strategic missile', STRATEGIC_MISSILE_COST)) {
    return { ok: false, reason: 'Insufficient credits' };
  }

  const def = WEAPONS.strategicMissile;
  const speed = def.projectile!.speed;
  const fromX = silo.transform.x;
  const fromZ = silo.transform.z;
  const fromY = sampleHeight(sim.nav.heightfield, fromX, fromZ) + 5.5;
  const accuracy = strategicAccuracy(economy.intelligenceLevel);
  const scatterAngle = deterministicUnit(target.id * 31 + sim.tick * 17 + 7) * Math.PI * 2;
  const scatterDistance = accuracy.radius * (0.58 + deterministicUnit(target.id * 47 + sim.tick * 13 + 19) * 0.42);
  const toX = target.transform.x + Math.cos(scatterAngle) * scatterDistance;
  const toZ = target.transform.z + Math.sin(scatterAngle) * scatterDistance;
  const toY = sampleHeight(sim.nav.heightfield, toX, toZ) + 1.1;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
  const duration = Math.max(2.8, distance / speed);
  sim.projectiles.push({
    kind: def.projectile!.kind,
    weaponKind: def.kind,
    fromX,
    fromY,
    fromZ,
    x: fromX,
    y: fromY,
    z: fromZ,
    toX,
    toY,
    toZ,
    elapsed: 0,
    duration,
    speed,
    maxDistance: sim.nav.size * Math.SQRT2 + 128,
    directTargetId: accuracy.radius === 0 ? target.id : undefined,
    trajectory: 'arc',
    teamId: economy.team,
    attackerId: silo.id,
    strategic: true,
  });
  economy.strategicMissileCooldown = STRATEGIC_MISSILE_COOLDOWN;
  const event: CombatEvent = {
    kind: def.projectile!.kind,
    weaponKind: def.kind,
    fromX,
    fromY,
    fromZ,
    toX,
    toY,
    toZ,
    targetId: target.id,
    targetLabel: target.building.label,
    targetType: 'building',
    sourceTeamId: economy.team,
    damage: 0,
    killed: false,
    duration,
    trajectory: 'arc',
  };
  sim.events.push(event);
  return { ok: true, reason: '', event };
}

function deterministicUnit(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}
