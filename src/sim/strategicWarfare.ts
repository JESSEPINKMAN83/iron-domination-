import { WEAPONS } from '../content/phase4';
import type { Entity } from './components';
import {
  buildings,
  hasStructure,
  spendCredits,
  type EconomyState,
  type IntelligenceCategory,
} from './economy';
import { sampleHeight } from './heightfield';
import { areTeamsHostile, entityById, type CombatEvent, type GameSim } from './world';

export const STRATEGIC_MISSILE_COST = 225;
export const STRATEGIC_MISSILE_COOLDOWN = 30;

export interface IntelligenceProgram {
  category: IntelligenceCategory;
  label: string;
  description: string;
  cost: number;
}

export const INTELLIGENCE_PROGRAMS: Record<IntelligenceCategory, IntelligenceProgram> = {
  economy: { category: 'economy', label: 'Ore Operations', description: 'Reveal refineries and ore collectors.', cost: 100 },
  power: { category: 'power', label: 'Power Grid', description: 'Reveal enemy power plants.', cost: 150 },
  military: { category: 'military', label: 'Military Sites', description: 'Reveal production and defensive structures.', cost: 250 },
  command: { category: 'command', label: 'Command Center', description: 'Reveal the enemy Command Yard.', cost: 400 },
};

export interface StrategicAccuracy {
  label: 'BLIND' | 'LOW' | 'MEDIUM' | 'PINPOINT';
  radius: number;
}

export interface StrategicWarhead {
  level: number;
  label: 'STANDARD' | 'HEAVY' | 'DEVASTATOR';
  damageScale: number;
  impactScale: number;
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
  if (level <= 1) return { level: 1, label: 'STANDARD', damageScale: 1, impactScale: 1 };
  if (level === 2) return { level: 2, label: 'HEAVY', damageScale: 1.65, impactScale: 1.4 };
  return { level: 3, label: 'DEVASTATOR', damageScale: 2.5, impactScale: 1.9 };
}

export function enemyIntelligenceCategories(economy: EconomyState, enemyTeam: number): IntelligenceCategory[] {
  return economy.intelligenceByTeam[enemyTeam] ?? [];
}

export function enemyIntelligenceLevel(economy: EconomyState, enemyTeam: number): number {
  return Math.min(3, enemyIntelligenceCategories(economy, enemyTeam).length);
}

export function purchaseEnemyIntelligence(
  sim: GameSim,
  economy: EconomyState,
  enemyTeam: number,
  category: IntelligenceCategory,
): { ok: boolean; reason: string } {
  const program = INTELLIGENCE_PROGRAMS[category];
  if (economy.doctrine !== 'missile-command') return { ok: false, reason: 'Missile Command doctrine only' };
  if (!hasStructure(sim, 'intelligence-center', economy.team)) return { ok: false, reason: 'Build an Intelligence Center' };
  if (!areTeamsHostile(sim, economy.team, enemyTeam)) return { ok: false, reason: 'Choose an enemy army' };
  const purchased = enemyIntelligenceCategories(economy, enemyTeam);
  if (purchased.includes(category)) return { ok: false, reason: 'Intelligence already acquired' };
  if (!spendCredits(economy, sim.tick, `${program.label} intelligence · Army ${enemyTeam}`, program.cost)) {
    return { ok: false, reason: 'Insufficient credits' };
  }
  economy.intelligenceByTeam[enemyTeam] = [...purchased, category];
  return { ok: true, reason: '' };
}

/** Continuously reveals structures covered by purchased, enemy-specific intelligence programs. */
export function discoverEnemyStructures(
  sim: GameSim,
  economy: EconomyState,
  knownTargetIds: Set<number>,
): Entity[] {
  if (!hasStructure(sim, 'intelligence-center', economy.team)) return [];
  const newlyDiscovered: Entity[] = [];
  for (const target of sim.world.entities) {
    const enemyTeam = target.team?.id;
    const kind = target.building?.kind;
    if (
      enemyTeam === undefined || target.destroyed || (!target.building && !target.harvester) ||
      (target.building && !target.building.complete) ||
      !areTeamsHostile(sim, economy.team, enemyTeam) || knownTargetIds.has(target.id)
    ) continue;
    const category = target.harvester ? 'economy' : intelligenceCategoryForStructure(kind!);
    if (!enemyIntelligenceCategories(economy, enemyTeam).includes(category)) continue;
    knownTargetIds.add(target.id);
    newlyDiscovered.push(target);
  }
  return newlyDiscovered.sort((a, b) => a.id - b.id);
}

export function knownStrategicTargets(sim: GameSim, knownTargetIds: Set<number>): Entity[] {
  return Array.from(knownTargetIds)
    .map((id) => entityById(sim, id))
    .filter((entity): entity is Entity => !!entity && (!!entity.building || !!entity.harvester) && !entity.destroyed && (entity.health?.current ?? 0) > 0)
    .sort((a, b) => a.id - b.id);
}

export function strategicLaunchReadiness(
  sim: GameSim,
  economy: EconomyState,
): { ready: boolean; reason: string; cooldown: number } {
  if (economy.doctrine !== 'missile-command') return { ready: false, reason: 'Missile Command doctrine only', cooldown: 0 };
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
  if (!knownTargetIds.has(targetId)) return { ok: false, reason: 'Target has not been identified' };
  const target = entityById(sim, targetId);
  if (
    !target || (!target.building && !target.harvester) || target.destroyed || !target.health || target.team?.id === undefined ||
    !areTeamsHostile(sim, economy.team, target.team.id)
  ) return { ok: false, reason: 'Target no longer available' };
  return launchAtArea(
    sim,
    economy,
    target.team.id,
    target.transform.x,
    target.transform.z,
    target,
    enemyIntelligenceLevel(economy, target.team.id),
  );
}

export function launchBlindStrategicMissile(
  sim: GameSim,
  economy: EconomyState,
  enemyTeam: number,
): StrategicLaunchResult {
  if (!areTeamsHostile(sim, economy.team, enemyTeam)) return { ok: false, reason: 'Choose an enemy army' };
  const enemyBase = buildings(sim, enemyTeam).find((entity) => entity.building?.kind === 'command-yard' && !entity.destroyed)
    ?? buildings(sim, enemyTeam).find((entity) => !entity.destroyed);
  if (!enemyBase) return { ok: false, reason: 'Enemy direction unavailable' };
  return launchAtArea(sim, economy, enemyTeam, enemyBase.transform.x, enemyBase.transform.z, undefined, 0);
}

function launchAtArea(
  sim: GameSim,
  economy: EconomyState,
  enemyTeam: number,
  targetX: number,
  targetZ: number,
  target: Entity | undefined,
  intelLevel: number,
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
  const accuracy = strategicAccuracy(intelLevel);
  const seedTarget = target?.id ?? enemyTeam * 101;
  const scatterAngle = deterministicUnit(seedTarget * 31 + sim.tick * 17 + 7) * Math.PI * 2;
  const scatterDistance = accuracy.radius * (0.58 + deterministicUnit(seedTarget * 47 + sim.tick * 13 + 19) * 0.42);
  const fromX = silo.transform.x;
  const fromZ = silo.transform.z;
  const fromY = sampleHeight(sim.nav.heightfield, fromX, fromZ) + 5.5;
  const toX = targetX + Math.cos(scatterAngle) * scatterDistance;
  const toZ = targetZ + Math.sin(scatterAngle) * scatterDistance;
  const toY = sampleHeight(sim.nav.heightfield, toX, toZ) + 1.1;
  const distance = Math.max(0.001, Math.hypot(toX - fromX, toY - fromY, toZ - fromZ));
  const duration = Math.max(2.8, distance / def.projectile!.speed);
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
    directTargetId: accuracy.radius === 0 ? target?.id : undefined,
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
    targetId: target?.id,
    targetLabel: target?.building?.label ?? target?.name ?? `Army ${enemyTeam} estimated area`,
    targetType: target?.building ? 'building' : target ? 'vehicle' : 'ground',
    sourceTeamId: economy.team,
    targetTeamId: enemyTeam,
    damage: 0,
    killed: false,
    duration,
    trajectory: 'arc',
    impactScale: warhead.impactScale,
  };
  sim.events.push({
    ...event,
    kind: 'strategic-missile-warning',
    targetLabel: `Incoming missile from Army ${economy.team}`,
  });
  sim.events.push(event);
  return { ok: true, reason: '', event };
}

function intelligenceCategoryForStructure(kind: string): IntelligenceCategory {
  if (kind === 'command-yard') return 'command';
  if (kind === 'power-plant') return 'power';
  if (kind === 'refinery') return 'economy';
  return 'military';
}

function deterministicUnit(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}
