import { WEAPONS } from '../content/phase4';
import { buildings, hasStructure, spendCredits, type EconomyState } from './economy';
import { sampleHeight, type Heightfield } from './heightfield';
import { areTeamsHostile, type CombatEvent, type GameSim } from './world';

export const STRATEGIC_MISSILE_COST = 225;
export const STRATEGIC_MISSILE_COOLDOWN = 30;
export const EMBER_DRONE_COST = 180;
export const EMBER_DRONE_COOLDOWN = 5;
export const EMBER_DRONE_MAX_IN_FLIGHT = 6;
export const EMBER_DRONE_SCATTER_RADIUS = 10;
export const EMBER_DRONE_HEALTH = 32;

/**
 * Finds the smallest smooth arc that clears the terrain between launch and
 * impact. Flat/rolling maps retain the authored baseline; mountain routes
 * gain only the extra altitude required by the ridges they actually cross.
 */
export function strategicTerrainClearanceLift(
  hf: Heightfield,
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  baselineLift: number,
  clearance: number,
): number {
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(20, Math.min(96, Math.ceil(distance / Math.max(4, hf.cellSize * 2))));
  let lift = baselineLift;
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    // Deployment shelves protect the immediate launch/impact zones. Sampling
    // the route core avoids an extreme near-vertical arc from endpoint noise.
    if (t < 0.06 || t > 0.94) continue;
    const x = fromX + (toX - fromX) * t;
    const z = fromZ + (toZ - fromZ) * t;
    const directY = fromY + (toY - fromY) * t;
    const arcWeight = Math.sin(Math.PI * t);
    const required = (sampleHeight(hf, x, z) + clearance - directY) / arcWeight;
    lift = Math.max(lift, required);
  }
  return Math.ceil(lift * 2) / 2;
}

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

export function emberLaunchReadiness(
  sim: GameSim,
  economy: EconomyState,
): { ready: boolean; reason: string; cooldown: number; inFlight: number } {
  const inFlight = sim.projectiles.filter(
    (projectile) => projectile.strategicProfile === 'drone' && projectile.teamId === economy.team && (projectile.strategicHealth ?? 0) > 0,
  ).length;
  if (economy.doctrine !== 'missile-command') return { ready: false, reason: 'Vesper Republic only', cooldown: 0, inFlight };
  if (!hasStructure(sim, 'intelligence-center', economy.team)) return { ready: false, reason: 'Build an Intelligence Center', cooldown: 0, inFlight };
  if (economy.powerProduced < economy.powerUsed) return { ready: false, reason: 'Insufficient power', cooldown: economy.emberDroneCooldown, inFlight };
  if (economy.emberDroneCooldown > 0) {
    return { ready: false, reason: `Rearming ${Math.ceil(economy.emberDroneCooldown)}s`, cooldown: economy.emberDroneCooldown, inFlight };
  }
  if (inFlight >= EMBER_DRONE_MAX_IN_FLIGHT) return { ready: false, reason: 'Six drones already airborne', cooldown: 0, inFlight };
  if (economy.credits < EMBER_DRONE_COST) return { ready: false, reason: 'Insufficient credits', cooldown: 0, inFlight };
  return { ready: true, reason: '', cooldown: 0, inFlight };
}

export function launchEmberDroneAt(
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
  const readiness = emberLaunchReadiness(sim, economy);
  if (!readiness.ready) return { ok: false, reason: readiness.reason };
  const center = buildings(sim, economy.team).find(
    (entity) => entity.building?.kind === 'intelligence-center' && entity.building.complete && !entity.destroyed,
  );
  if (!center) return { ok: false, reason: 'No operational Intelligence Center' };
  if (!spendCredits(economy, sim.tick, 'Ember one-way drone', EMBER_DRONE_COST)) {
    return { ok: false, reason: 'Insufficient credits' };
  }

  const def = WEAPONS.emberDrone;
  const scatterAngle = deterministicUnit(enemyTeam * 61 + sim.tick * 29 + center.id) * Math.PI * 2;
  const scatterDistance = EMBER_DRONE_SCATTER_RADIUS * Math.sqrt(deterministicUnit(enemyTeam * 83 + sim.tick * 19 + center.id * 7));
  const fromX = center.transform.x;
  const fromZ = center.transform.z;
  const fromY = sampleHeight(sim.nav.heightfield, fromX, fromZ) + 8;
  const toX = targetX + Math.cos(scatterAngle) * scatterDistance;
  const toZ = targetZ + Math.sin(scatterAngle) * scatterDistance;
  const toY = sampleHeight(sim.nav.heightfield, toX, toZ) + 2.2;
  const distance = Math.max(0.001, Math.hypot(toX - fromX, toZ - fromZ));
  const strategicLift = strategicTerrainClearanceLift(
    sim.nav.heightfield,
    fromX,
    fromY,
    fromZ,
    toX,
    toY,
    toZ,
    5,
    4.5,
  );
  const duration = Math.max(5, distance / def.projectile!.speed);
  const strategicId = (sim.tick + 1) * 1_000_000 + center.id;
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
    damageScale: 1,
    impactScale: 0.95,
    maxDistance: sim.nav.size * Math.SQRT2 + 128,
    directTargetId: undefined,
    trajectory: 'flat',
    teamId: economy.team,
    attackerId: center.id,
    strategic: true,
    strategicProfile: 'drone',
    strategicLift,
    strategicId,
    strategicTargetTeamId: enemyTeam,
    strategicHealth: EMBER_DRONE_HEALTH,
    strategicMaxHealth: EMBER_DRONE_HEALTH,
  });
  economy.emberDroneCooldown = EMBER_DRONE_COOLDOWN;
  const event: CombatEvent = {
    kind: def.projectile!.kind,
    weaponKind: def.kind,
    fromX,
    fromY,
    fromZ,
    toX,
    toY,
    toZ,
    targetLabel: `Army ${enemyTeam} marked drone impact area`,
    targetType: 'ground',
    sourceTeamId: economy.team,
    targetTeamId: enemyTeam,
    damage: 0,
    killed: false,
    duration,
    trajectory: 'flat',
    impactScale: 0.95,
    strategicId,
    strategicLift,
    targetHealth: EMBER_DRONE_HEALTH,
    targetMaxHealth: EMBER_DRONE_HEALTH,
  };
  sim.events.push({
    ...event,
    kind: 'ember-drone-warning',
    targetLabel: `Incoming Ember drone from Army ${economy.team}`,
  });
  sim.events.push(event);
  return { ok: true, reason: '', event };
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
  const strategicLift = strategicTerrainClearanceLift(
    sim.nav.heightfield,
    fromX,
    fromY,
    fromZ,
    toX,
    toY,
    toZ,
    Math.min(28, Math.hypot(toX - fromX, toZ - fromZ) * 0.32),
    8,
  );
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
    strategicProfile: 'ballistic',
    strategicLift,
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
    strategicLift,
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
