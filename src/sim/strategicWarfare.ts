import { WEAPONS } from '../content/phase4';
import { buildings, hasStructure, spendCredits, type EconomyState } from './economy';
import { sampleHeight, type Heightfield } from './heightfield';
import { areTeamsHostile, type CombatEvent, type GameSim } from './world';

export const STRATEGIC_MISSILE_COST = 225;
export const STRATEGIC_MISSILE_MAX_COST = 2500;
export const STRATEGIC_MISSILE_COOLDOWN = 90;
export const EMBER_DRONE_COST = 180;
export const EMBER_DRONE_COOLDOWN = 60;
export const EMBER_DRONE_SALVO_WINDOW = 2;
export const EMBER_DRONE_MAX_IN_FLIGHT = 10;
export const EMBER_DRONE_SCATTER_RADIUS = 10;
export const EMBER_DRONE_HEALTH = 32;
export const EMBER_DRONE_SEEKER_RADIUS = 42;

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
  label: 'BLIND' | 'ROUGH' | 'LOW' | 'GUIDED' | 'MEDIUM' | 'HIGH' | 'PRECISE' | 'SURGICAL' | 'PINPOINT';
  radius: number;
}

export interface StrategicWarhead {
  level: number;
  label: 'STANDARD' | 'ENHANCED' | 'HEAVY' | 'BREACHER' | 'SIEGE' | 'DEVASTATOR' | 'CATACLYSM' | 'APOCALYPSE';
  damageScale: number;
  impactScale: number;
  interceptionHealth: number;
}

export interface EmberWarhead {
  level: number;
  label: 'STANDARD' | 'REINFORCED' | 'SHAPED' | 'BREACHER' | 'HEAVY' | 'SIEGE' | 'DEVASTATOR' | 'INFERNO';
  damageScale: number;
  impactScale: number;
}

export interface StrategicLaunchResult {
  ok: boolean;
  reason: string;
  event?: CombatEvent;
}

export function strategicAccuracy(level: number): StrategicAccuracy {
  if (level <= 0) return { label: 'BLIND', radius: 48 };
  if (level === 1) return { label: 'ROUGH', radius: 40 };
  if (level === 2) return { label: 'LOW', radius: 33 };
  if (level === 3) return { label: 'GUIDED', radius: 27 };
  if (level === 4) return { label: 'MEDIUM', radius: 21 };
  if (level === 5) return { label: 'HIGH', radius: 15 };
  if (level === 6) return { label: 'PRECISE', radius: 10 };
  if (level === 7) return { label: 'SURGICAL', radius: 5 };
  return { label: 'PINPOINT', radius: 0 };
}

export function strategicMissileAccuracyLevel(economy: EconomyState): number {
  return economy.strategicAccuracyLevel;
}

export function strategicWarhead(level: number): StrategicWarhead {
  if (level <= 1) return { level: 1, label: 'STANDARD', damageScale: 1, impactScale: 1.6, interceptionHealth: 100 };
  if (level === 2) return { level: 2, label: 'ENHANCED', damageScale: 1.3, impactScale: 1.85, interceptionHealth: 115 };
  if (level === 3) return { level: 3, label: 'HEAVY', damageScale: 1.65, impactScale: 2.1, interceptionHealth: 135 };
  if (level === 4) return { level: 4, label: 'BREACHER', damageScale: 2.05, impactScale: 2.4, interceptionHealth: 155 };
  if (level === 5) return { level: 5, label: 'SIEGE', damageScale: 2.5, impactScale: 2.7, interceptionHealth: 180 };
  if (level === 6) return { level: 6, label: 'DEVASTATOR', damageScale: 3, impactScale: 3, interceptionHealth: 205 };
  if (level === 7) return { level: 7, label: 'CATACLYSM', damageScale: 3.55, impactScale: 3.35, interceptionHealth: 235 };
  return { level: 8, label: 'APOCALYPSE', damageScale: 4.2, impactScale: 3.7, interceptionHealth: 270 };
}

export function emberWarhead(level: number): EmberWarhead {
  if (level <= 1) return { level: 1, label: 'STANDARD', damageScale: 1, impactScale: 0.95 };
  if (level === 2) return { level: 2, label: 'REINFORCED', damageScale: 1.18, impactScale: 1.05 };
  if (level === 3) return { level: 3, label: 'SHAPED', damageScale: 1.38, impactScale: 1.15 };
  if (level === 4) return { level: 4, label: 'BREACHER', damageScale: 1.6, impactScale: 1.26 };
  if (level === 5) return { level: 5, label: 'HEAVY', damageScale: 1.84, impactScale: 1.38 };
  if (level === 6) return { level: 6, label: 'SIEGE', damageScale: 2.1, impactScale: 1.5 };
  if (level === 7) return { level: 7, label: 'DEVASTATOR', damageScale: 2.38, impactScale: 1.63 };
  return { level: 8, label: 'INFERNO', damageScale: 2.7, impactScale: 1.78 };
}

export function emberScatterRadius(): number {
  return EMBER_DRONE_SCATTER_RADIUS;
}

export function emberDroneSalvoSize(economy: EconomyState): number {
  return Math.max(1, Math.min(10, Math.round(economy.emberDroneQuantityLevel)));
}

export function emberDroneLaunchCost(economy: EconomyState): number {
  return EMBER_DRONE_COST * emberDroneSalvoSize(economy);
}

export function strategicMissileLaunchCost(economy: EconomyState): number {
  const level = Math.max(1, Math.min(8, Math.round(economy.strategicMissileLevel)));
  const progress = (level - 1) / 7;
  return Math.round((STRATEGIC_MISSILE_COST + (STRATEGIC_MISSILE_MAX_COST - STRATEGIC_MISSILE_COST) * progress) / 25) * 25;
}

export function strategicLaunchReadiness(
  sim: GameSim,
  economy: EconomyState,
): { ready: boolean; reason: string; cooldown: number } {
  const launchCost = strategicMissileLaunchCost(economy);
  if (economy.doctrine !== 'missile-command') return { ready: false, reason: 'Vesper Republic only', cooldown: 0 };
  if (!hasStructure(sim, 'strategic-silo', economy.team)) return { ready: false, reason: 'Build a Missile Silo', cooldown: 0 };
  if (economy.powerProduced < economy.powerUsed) return { ready: false, reason: 'Insufficient power', cooldown: economy.strategicMissileCooldown };
  if (economy.strategicMissileCooldown > 0) {
    return { ready: false, reason: `Reloading ${Math.ceil(economy.strategicMissileCooldown)}s`, cooldown: economy.strategicMissileCooldown };
  }
  if (economy.credits < launchCost) return { ready: false, reason: 'Insufficient credits', cooldown: 0 };
  return { ready: true, reason: '', cooldown: 0 };
}

export function emberLaunchReadiness(
  sim: GameSim,
  economy: EconomyState,
): { ready: boolean; reason: string; cooldown: number; inFlight: number } {
  const inFlight = sim.projectiles.filter(
    (projectile) => projectile.strategicProfile === 'drone' && projectile.teamId === economy.team && (projectile.strategicHealth ?? 0) > 0,
  ).length;
  const salvoSize = emberDroneSalvoSize(economy);
  const launchCost = emberDroneLaunchCost(economy);
  if (economy.doctrine !== 'missile-command') return { ready: false, reason: 'Vesper Republic only', cooldown: 0, inFlight };
  if (!hasStructure(sim, 'intelligence-center', economy.team)) return { ready: false, reason: 'Build an Intelligence Center', cooldown: 0, inFlight };
  if (economy.powerProduced < economy.powerUsed) return { ready: false, reason: 'Insufficient power', cooldown: economy.emberDroneCooldown, inFlight };
  if (economy.emberDroneCooldown > 0) {
    return { ready: false, reason: `Rearming ${Math.ceil(economy.emberDroneCooldown)}s`, cooldown: economy.emberDroneCooldown, inFlight };
  }
  if (inFlight + salvoSize > EMBER_DRONE_MAX_IN_FLIGHT) {
    return { ready: false, reason: `Wait for ${inFlight} airborne drone${inFlight === 1 ? '' : 's'} to clear`, cooldown: 0, inFlight };
  }
  if (economy.credits < launchCost) return { ready: false, reason: 'Insufficient credits', cooldown: 0, inFlight };
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
  const salvoSize = emberDroneSalvoSize(economy);
  const launchCost = emberDroneLaunchCost(economy);
  if (!spendCredits(economy, sim.tick, `Ember salvo ×${salvoSize}`, launchCost)) {
    return { ok: false, reason: 'Insufficient credits' };
  }

  const def = WEAPONS.emberDrone;
  const warhead = emberWarhead(economy.emberDroneWarheadLevel);
  const routeLength = Math.max(0.001, Math.hypot(targetX - center.transform.x, targetZ - center.transform.z));
  const lateralX = -(targetZ - center.transform.z) / routeLength;
  const lateralZ = (targetX - center.transform.x) / routeLength;
  const launchDelays = emberSalvoLaunchDelays(salvoSize, enemyTeam, sim.tick, center.id);
  let firstEvent: CombatEvent | undefined;
  for (let index = 0; index < salvoSize; index++) {
    const launchDelay = launchDelays[index] ?? 0;
    const launchOffset = (index - (salvoSize - 1) * 0.5) * 0.9;
    const scatterAngle = deterministicUnit(enemyTeam * 61 + sim.tick * 29 + center.id + index * 101) * Math.PI * 2;
    const scatterDistance = EMBER_DRONE_SCATTER_RADIUS * Math.sqrt(
      deterministicUnit(enemyTeam * 83 + sim.tick * 19 + center.id * 7 + index * 137),
    );
    const fromX = center.transform.x + lateralX * launchOffset;
    const fromZ = center.transform.z + lateralZ * launchOffset;
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
    const strategicId = (sim.tick + 1) * 1_000_000 + 500_000 + center.id * 16 + index;
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
      launchDelay,
      speed: def.projectile!.speed,
      damageScale: warhead.damageScale,
      impactScale: warhead.impactScale,
      maxDistance: sim.nav.size * Math.SQRT2 + 128,
      directTargetId: undefined,
      trajectory: 'flat',
      teamId: economy.team,
      attackerId: center.id,
      strategic: true,
      strategicProfile: 'drone',
      strategicSeeker: {
        radius: EMBER_DRONE_SEEKER_RADIUS,
        fallbackX: toX,
        fallbackY: toY,
        fallbackZ: toZ,
        fallbackTargetTeamId: enemyTeam,
      },
      strategicLift,
      strategicId,
      strategicTargetTeamId: enemyTeam,
      strategicHealth: EMBER_DRONE_HEALTH,
      strategicMaxHealth: EMBER_DRONE_HEALTH,
    });
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
      launchDelay,
      trajectory: 'flat',
      impactScale: warhead.impactScale,
      strategicId,
      strategicLift,
      targetHealth: EMBER_DRONE_HEALTH,
      targetMaxHealth: EMBER_DRONE_HEALTH,
    };
    if (!firstEvent) {
      firstEvent = event;
      sim.events.push({
        ...event,
        kind: 'ember-drone-warning',
        targetLabel: `Incoming Ember salvo ×${salvoSize} from Army ${economy.team}`,
      });
    }
    sim.events.push(event);
  }
  economy.emberDroneCooldown = EMBER_DRONE_COOLDOWN;
  return { ok: true, reason: '', event: firstEvent };
}

function emberSalvoLaunchDelays(salvoSize: number, enemyTeam: number, tick: number, sourceId: number): number[] {
  if (salvoSize <= 1) return [0];
  const delays = [0];
  const slot = EMBER_DRONE_SALVO_WINDOW / (salvoSize - 1);
  for (let index = 1; index < salvoSize; index++) {
    const jitter = (deterministicUnit(enemyTeam * 97 + tick * 43 + sourceId * 17 + index * 149) - 0.5) * slot * 0.36;
    delays.push(Math.min(EMBER_DRONE_SALVO_WINDOW, index * slot + jitter));
  }
  return delays;
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
  const launchCost = strategicMissileLaunchCost(economy);
  if (!spendCredits(economy, sim.tick, `Strategic missile · warhead ${economy.strategicMissileLevel}`, launchCost)) {
    return { ok: false, reason: 'Insufficient credits' };
  }

  const def = WEAPONS.strategicMissile;
  const warhead = strategicWarhead(economy.strategicMissileLevel);
  const accuracy = strategicAccuracy(strategicMissileAccuracyLevel(economy));
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
