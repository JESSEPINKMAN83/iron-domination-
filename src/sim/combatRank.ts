import { UNITS, type UnitKind } from '../content/phase3';
import type { Entity } from './components';
import { unitKindForUpgrade } from './upgrades';

/** Recruit = 0 (no badge). Veteran / Elite / Ace are earned in combat. */
export type CombatRankLevel = 0 | 1 | 2 | 3;

export const COMBAT_RANK_NAMES = ['Recruit', 'Veteran', 'Elite', 'Ace'] as const;
export type CombatRankName = (typeof COMBAT_RANK_NAMES)[number];

export interface CombatRankState {
  /** Current earned rank (0–3). */
  rank: CombatRankLevel;
  /** Accumulated kill value (enemy unit costs) credited to this unit. */
  killValue: number;
  /** Cost used for promotion thresholds (frozen at spawn). */
  unitCost: number;
}

/** Kill-value thresholds as multiples of the unit's own cost. */
const RANK_COST_MULTIPLES: readonly number[] = [0, 1, 3, 6];

const RANK_DAMAGE: readonly number[] = [1, 1.12, 1.24, 1.4];
const RANK_COOLDOWN: readonly number[] = [1, 0.91, 0.83, 0.76];
const RANK_ACCURACY: readonly number[] = [1, 1.1, 1.18, 1.28];
const RANK_SCATTER: readonly number[] = [1, 0.9, 0.82, 0.72];

export function combatRankName(rank: CombatRankLevel): CombatRankName {
  return COMBAT_RANK_NAMES[rank];
}

export function isCombatRankEligible(entity: Entity): boolean {
  if (!entity.team || entity.building || entity.harvester) return false;
  if (!entity.mover || entity.destroyed) return false;
  return Boolean(entity.weapon || entity.weapons);
}

export function unitCombatCost(entity: Entity): number {
  const kind = unitKindForUpgrade(entity);
  if (kind && UNITS[kind]) return UNITS[kind].cost;
  if (entity.flight) return 650;
  if (entity.selectable?.type === 'tank') return 550;
  if (entity.armor?.kind === 'infantry') return 100;
  return 400;
}

export function ensureCombatRank(entity: Entity): CombatRankState | undefined {
  if (!isCombatRankEligible(entity)) return undefined;
  if (!entity.combatRank) {
    entity.combatRank = {
      rank: 0,
      killValue: 0,
      unitCost: Math.max(1, unitCombatCost(entity)),
    };
  }
  return entity.combatRank;
}

export function combatRankDamageMultiplier(entity: Entity): number {
  return RANK_DAMAGE[entity.combatRank?.rank ?? 0] ?? 1;
}

export function combatRankCooldownMultiplier(entity: Entity): number {
  return RANK_COOLDOWN[entity.combatRank?.rank ?? 0] ?? 1;
}

export function combatRankAccuracyMultiplier(entity: Entity): number {
  return RANK_ACCURACY[entity.combatRank?.rank ?? 0] ?? 1;
}

export function combatRankScatterMultiplier(entity: Entity): number {
  return RANK_SCATTER[entity.combatRank?.rank ?? 0] ?? 1;
}

export function killValueForTarget(target: Entity): number {
  if (target.building) {
    // Structures count, but less than wiping a peer-cost army — keeps Ace rare.
    return Math.max(40, Math.round(unitCombatCost(target) * 0.35));
  }
  return Math.max(1, unitCombatCost(target));
}

export function rankThreshold(unitCost: number, rank: CombatRankLevel): number {
  return unitCost * (RANK_COST_MULTIPLES[rank] ?? 0);
}

/**
 * Credit a kill (or last-hit destruction) toward the attacker's combat rank.
 * Returns the new rank when a promotion happened, otherwise undefined.
 */
export function creditCombatKill(attacker: Entity, target: Entity): CombatRankLevel | undefined {
  if (attacker.team && target.team && attacker.team.id === target.team.id) return undefined;
  const state = ensureCombatRank(attacker);
  if (!state || state.rank >= 3) return undefined;

  state.killValue += killValueForTarget(target);
  const before = state.rank;
  while (state.rank < 3 && state.killValue >= rankThreshold(state.unitCost, (state.rank + 1) as CombatRankLevel)) {
    state.rank = (state.rank + 1) as CombatRankLevel;
  }
  return state.rank > before ? state.rank : undefined;
}

export type CombatRankShareSummary = {
  rankRecruitShare: number;
  rankVeteranShare: number;
  rankEliteShare: number;
  rankAceShare: number;
  rankCounts: string;
  combatUnitCount: number;
};

/** Peak-rank mix for a team's combat units (shares sum to 1 when any units exist). */
export function summarizeCombatRankShares(entities: Iterable<Entity>, teamId: number): CombatRankShareSummary {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const entity of entities) {
    if (entity.team?.id !== teamId) continue;
    if (entity.building || entity.harvester || !entity.mover) continue;
    if (!(entity.weapon || entity.weapons || entity.combatRank)) continue;
    const rank = entity.combatRank?.rank ?? 0;
    counts[rank] += 1;
  }
  const total = counts[0] + counts[1] + counts[2] + counts[3];
  const share = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 1000 : 0);
  return {
    rankRecruitShare: share(counts[0]),
    rankVeteranShare: share(counts[1]),
    rankEliteShare: share(counts[2]),
    rankAceShare: share(counts[3]),
    rankCounts: `recruit:${counts[0]},veteran:${counts[1]},elite:${counts[2]},ace:${counts[3]}`,
    combatUnitCount: total,
  };
}

/** @internal test helper */
export function combatRankMultiplesForTests(): readonly number[] {
  return RANK_COST_MULTIPLES;
}
