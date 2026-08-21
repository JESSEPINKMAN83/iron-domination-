import { WEAPONS } from '../content/phase4';
import { buildings, hasStructure, spendCredits, type EconomyState } from './economy';
import { sampleHeight } from './heightfield';
import { areTeamsHostile, type CombatEvent, type GameSim } from './world';

export const STRATEGIC_MISSILE_COST = 225;
export const STRATEGIC_MISSILE_COOLDOWN = 30;

export interface StrategicAccuracy {
  label: 'BLIND' | 'LOW' | 'MEDIUM' | 'PINPOINT';
  radius: number;
}

export interface StrategicWarhead {
  level: number;
  label: 'STANDARD' | 'HEAVY' | 'DEVASTATOR';
  damageScale: number;
  impactScale: number;
  interceptionHealth: number;
}

export interface StrategicLaunchResult {
  ok: boolean;
  reason: string;
  event?: CombatEvent;
}

export function strategicAccuracy(level: number): StrategicAccuracy {
  if (level <= 0) return { label: 'BLIND', radius: 110 };
  if (level === 1) return { label: 'LOW', radius: 55 };
  if (level === 2) return { label: 'MEDIUM', radius: 22 };
  return { label: 'PINPOINT', radius: 0 };
}

export function strategicWarhead(level: number): StrategicWarhead {
  if (level <= 1) return { level: 1, label: 'STANDARD', damageScale: 1, impactScale: 1.6, interceptionHealth: 100 };
  if (level === 2) return { level: 2, label: 'HEAVY', damageScale: 1.75, impactScale: 2.25, interceptionHealth: 140 };
  return { level: 3, label: 'DEVASTATOR', damageScale: 2.8, impactScale: 3.1, interceptionHealth: 200 };
}

export function strategicLaunchReadiness(
  sim: GameSim,
  economy: EconomyState,
): { ready: boolean; reason: string; cooldown: number } {
  if (economy.doctrine !== 'missile-command') return { ready: false, reason: 'Vesper Republic only', cooldown: 0 };
  if (!hasStructure(sim, 'strategic-silo', economy.team)) return { ready: false, reason: 'Build a Missile Silo', cooldown: 0 };
  if (economy.powerProduced < economy.powerUsed) return { ready: false, reason: 'Insufficient power', cooldown: economy.strategicMissileCooldown };
  if (economy.strategicMissileCooldown > 0) {
    return { ready: false, reason: `Reloading ${Math.ceil(economy.strategicMissileCooldown)}s`, cooldown: economy.strategicMissileCooldown };
  }
  if (economy.credits < STRATEGIC_MISSILE_COST) return { ready: false, reason: 'Insufficient credits', cooldown: 0 };
  return { ready: true, reason: '', cooldown: 0 };
}

export function launchStrategicMissileAt(
  sim: GameSim,
  economy: EconomyState,
  enemyTeam: number,
  targetX: number,
  targetZ: number,
): StrategicLaunchResult {
  if (!areTeamsHostile(sim, economy.team, enemyTeam)) return { ok: false, reason: 'Choose an enemy army' };
  const halfSize = sim.nav.size * 0.5;
  if (!Number.isFinite(targetX) || !Number.isFinite(targetZ) || Math.abs(targetX) > halfSize || Math.abs(targetZ) > halfSize) {
    return { ok: false, reason: 'Choose a point inside the battlefield' };
  }
  return launchAtArea(sim, economy, enemyTeam, targetX, targetZ);
}

function launchAtArea(
  sim: GameSim,
  economy: EconomyState,
  enemyTeam: number,
  targetX: number,
  targetZ: number,
): StrategicLaunchResult {
  const readiness = strategicLaunchReadiness(sim, economy);
  if (!readiness.ready) return { ok: false, reason: readiness.reason };
  const silo = buildings(sim, economy.team).find(
    (entity) => entity.building?.kind === 'strategic-silo' && entity.building.complete && !entity.destroyed,
  );
  if (!silo) return { ok: false, reason: 'No operational silo' };
  if (!spendCredits(economy, sim.tick, 'Strategic missile', STRATEGIC_MISSILE_COST)) {
    return { ok: false, reason: 'Insufficient credits' };
  }

  const def = WEAPONS.strategicMissile;
  const warhead = strategicWarhead(economy.strategicMissileLevel);
  const accuracy = strategicAccuracy(economy.strategicAccuracyLevel);
  const seedTarget = enemyTeam * 101;
  const scatterAngle = deterministicUnit(seedTarget * 31 + sim.tick * 17 + 7) * Math.PI * 2;
  const scatterDistance = accuracy.radius * Math.sqrt(deterministicUnit(seedTarget * 47 + sim.tick * 13 + 19));
  const fromX = silo.transform.x;
  const fromZ = silo.transform.z;
  const fromY = sampleHeight(sim.nav.heightfield, fromX, fromZ) + 5.5;
  const toX = targetX + Math.cos(scatterAngle) * scatterDistance;
  const toZ = targetZ + Math.sin(scatterAngle) * scatterDistance;
  const toY = sampleHeight(sim.nav.heightfield, toX, toZ) + 1.1;
  const distance = Math.max(0.001, Math.hypot(toX - fromX, toY - fromY, toZ - fromZ));
  const duration = Math.max(2.8, distance / def.projectile!.speed);
  const strategicId = (sim.tick + 1) * 1_000_000 + silo.id;
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
    speed: def.projectile!.speed,
    damageScale: warhead.damageScale,
    impactScale: warhead.impactScale,
    maxDistance: sim.nav.size * Math.SQRT2 + 128,
    directTargetId: undefined,
    trajectory: 'arc',
    teamId: economy.team,
    attackerId: silo.id,
    strategic: true,
    strategicId,
    strategicTargetTeamId: enemyTeam,
    strategicHealth: warhead.interceptionHealth,
    strategicMaxHealth: warhead.interceptionHealth,
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
    targetLabel: `Army ${enemyTeam} marked impact area`,
    targetType: 'ground',
    sourceTeamId: economy.team,
    targetTeamId: enemyTeam,
    damage: 0,
    killed: false,
    duration,
    trajectory: 'arc',
    impactScale: warhead.impactScale,
    strategicId,
    targetHealth: warhead.interceptionHealth,
    targetMaxHealth: warhead.interceptionHealth,
  };
  sim.events.push({
    ...event,
    kind: 'strategic-missile-warning',
    targetLabel: `Incoming missile from Army ${economy.team}`,
  });
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
