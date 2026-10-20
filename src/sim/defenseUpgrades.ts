import { STRUCTURES, type StructureKind } from '../content/phase3';
import { WEAPONS } from '../content/phase4';
import type { Entity } from './components';
import type { EconomyState } from './economy';
import type { GameSim } from './world';

export const DEFENSE_UPGRADE_COSTS = [100, 250, 500] as const;
const DEFENSES = new Set(['guard-tower', 'aa-tower', 'missile-defense', 'skylance-ciws']);
const HULL = [1, 1.4, 1.9, 2.6];
const POWER = [1, 1.2, 1.55, 2.1];
const RELOAD = [1, .92, .8, .65];
const MISSILE_SPEED = [1, 1.15, 1.3, 1.5];
export function isUpgradeableDefense(entity: Entity | undefined): boolean {
  return Boolean(entity?.building && DEFENSES.has(entity.building.kind));
}
export function defenseLevel(entity: Entity | undefined): number {
  return Math.max(0, Math.min(3, Math.floor(entity?.building?.defenseLevel ?? 0)));
}
export function defensePower(entity: Entity | undefined): number { return POWER[defenseLevel(entity)]; }
export function defenseReload(entity: Entity | undefined): number { return RELOAD[defenseLevel(entity)]; }
export function defenseMissileSpeed(entity: Entity | undefined): number { return MISSILE_SPEED[defenseLevel(entity)]; }
export function defenseUpgradeCost(entity: Entity | undefined): number { return DEFENSE_UPGRADE_COSTS[defenseLevel(entity)] ?? 0; }
export const DEFENSE_TIER_DESCRIPTIONS = [
  'Air/missile coverage where missing. +40% maximum hull; +20% damage; faster reload and missiles.',
  '90% more hull than base; 55% more damage; 20% shorter reload; 30% faster missiles.',
  '160% more hull than base; 110% more damage; 35% shorter reload; 50% faster missiles.',
];

export function purchaseDefenseUpgrade(sim: GameSim, economy: EconomyState, id: number, expectedLevel: number): { ok: boolean; reason: string } {
  const entity = sim.byId.get(id);
  if (!entity || !isUpgradeableDefense(entity) || entity.team?.id !== economy.team || entity.destroyed || !entity.health || entity.health.current <= 0 || !entity.building?.complete) return { ok: false, reason: 'Select a completed friendly defense' };
  const level = defenseLevel(entity), cost = defenseUpgradeCost(entity);
  if (level !== expectedLevel) return { ok: false, reason: 'Tower level changed' };
  if (level >= 3) return { ok: false, reason: 'Maximum level reached' };
  if (economy.credits < cost) return { ok: false, reason: `Need $${cost}` };
  economy.credits -= cost;
  economy.ledger.push({ tick: sim.tick, type: 'spend', label: `${entity.building.label} level ${level + 1}`, amount: -cost });
  const healthFraction = entity.health.current / entity.health.max;
  const baseHealth = STRUCTURES[entity.building.kind as StructureKind].health!;
  entity.building.defenseLevel = level + 1;
  entity.health.max = Math.round(baseHealth * HULL[level + 1]);
  entity.health.current = entity.health.max * healthFraction;
  // An independent AA mount preserves the guard tower's existing ground weapons
  // and lets Arrow defend itself against aircraft without changing its main role.
  if (entity.building.kind === 'guard-tower' || entity.building.kind === 'missile-defense') {
    entity.building.airDefenseWeapon ??= { kind: 'aaMissile', range: WEAPONS.aaMissile.airRange ?? 145, cooldown: 0 };
  }
  return { ok: true, reason: `Defense upgraded to level ${level + 1}` };
}
