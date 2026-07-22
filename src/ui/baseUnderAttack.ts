import type { Entity } from '../sim/components';
import type { CombatEvent } from '../sim/world';

export interface BaseUnderAttackAlert {
  x: number;
  z: number;
  label: string;
  critical: boolean;
}

const DEFAULT_COOLDOWN_TICKS = 12 * 30; // 12s at 30 Hz

/** Cooldown gate so base-under-attack VO/callouts do not spam every hit. */
export class BaseUnderAttackGate {
  private nextAllowedTick = 0;

  constructor(private readonly cooldownTicks = DEFAULT_COOLDOWN_TICKS) {}

  tryTrigger(tick: number, find: () => BaseUnderAttackAlert | undefined): BaseUnderAttackAlert | undefined {
    if (tick < this.nextAllowedTick) return undefined;
    const alert = find();
    if (!alert) return undefined;
    this.nextAllowedTick = tick + this.cooldownTicks;
    return alert;
  }
}

/**
 * Finds the highest-priority friendly structure hit in this combat event batch.
 * Prefers command yard / critical hull, then any other building taking damage.
 */
export function findFriendlyBuildingUnderAttack(
  events: readonly CombatEvent[],
  byId: ReadonlyMap<number, Entity>,
  localTeam: number,
): BaseUnderAttackAlert | undefined {
  let best: BaseUnderAttackAlert | undefined;
  let bestScore = -1;

  for (const event of events) {
    if (event.damage <= 0 || event.targetId === undefined) continue;
    if (event.kind === 'impact-reaction') continue;
    if (event.targetType && event.targetType !== 'building') continue;

    const entity = byId.get(event.targetId);
    if (!entity?.building || entity.destroyed || entity.team?.id !== localTeam) continue;
    if (entity.health && entity.health.current <= 0) continue;

    const label = entity.building.label ?? entity.name ?? 'Structure';
    const hullPct = entity.health ? entity.health.current / Math.max(1, entity.health.max) : 1;
    const critical = entity.building.kind === 'command-yard' || hullPct < 0.35;
    const score =
      (entity.building.kind === 'command-yard' ? 1000 : 0) +
      (critical ? 200 : 0) +
      event.damage +
      (event.killed ? 50 : 0);

    if (score <= bestScore) continue;
    bestScore = score;
    best = {
      x: entity.transform.x,
      z: entity.transform.z,
      label,
      critical,
    };
  }

  return best;
}
