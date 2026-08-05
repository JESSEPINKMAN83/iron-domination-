import type { Entity, TacticEndAction, TacticPlan } from './components';
import { areTeamsHostile, attackStandoffPoint, entityById, issueMoveOrder, type GameSim } from './world';

export const MAX_TACTIC_WAYPOINTS = 8;

export function cloneTacticEndAction(endAction: TacticEndAction): TacticEndAction {
  if (endAction.kind === 'attack') return { kind: 'attack', targetId: endAction.targetId };
  return { kind: endAction.kind };
}

export function cloneTacticPlan(plan: TacticPlan): TacticPlan {
  return {
    remaining: plan.remaining.map((point) => ({ x: point.x, z: point.z })),
    endAction: cloneTacticEndAction(plan.endAction),
  };
}

/** Eligible combat units only — buildings and harvesters are out of scope for v1. */
export function tacticEligibleEntities(entities: Entity[]): Entity[] {
  return entities.filter(
    (entity) =>
      !!entity.mover &&
      !entity.destroyed &&
      !entity.building &&
      !entity.harvester &&
      !!entity.team,
  );
}

export function validateTacticWaypoints(
  waypoints: Array<{ x: number; z: number }>,
): waypoints is Array<{ x: number; z: number }> {
  if (!Array.isArray(waypoints) || waypoints.length < 1 || waypoints.length > MAX_TACTIC_WAYPOINTS) return false;
  return waypoints.every(
    (point) =>
      point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.z),
  );
}

export function validateTacticEndAction(endAction: TacticEndAction): boolean {
  if (!endAction || typeof endAction !== 'object') return false;
  if (endAction.kind === 'hold' || endAction.kind === 'attack-move') return true;
  return endAction.kind === 'attack' && Number.isInteger(endAction.targetId) && endAction.targetId > 0;
}

/**
 * Issues a multi-waypoint tactic. Units move to the first point immediately;
 * further points and the end action are applied as each waypoint is reached.
 */
export function issueTacticOrder(
  sim: GameSim,
  entities: Entity[],
  waypoints: Array<{ x: number; z: number }>,
  endAction: TacticEndAction,
): boolean {
  if (!validateTacticWaypoints(waypoints) || !validateTacticEndAction(endAction)) return false;
  const movers = tacticEligibleEntities(entities);
  if (movers.length === 0) return false;
  if (endAction.kind === 'attack') {
    const target = entityById(sim, endAction.targetId);
    const team = movers[0].team?.id;
    if (!target || target.destroyed || !target.health || target.health.current <= 0 ||
      !areTeamsHostile(sim, team, target.team?.id)) return false;
  }

  const first = waypoints[0];
  const remaining = waypoints.slice(1).map((point) => ({ x: point.x, z: point.z }));
  const planSeed: TacticPlan = {
    remaining,
    endAction: cloneTacticEndAction(endAction),
  };

  if (!issueMoveOrder(sim, movers, first.x, first.z, false)) return false;

  let assigned = 0;
  for (const entity of movers) {
    if (!entity.mover) continue;
    // issueMoveOrder clears tactic; re-attach the shared remaining queue per unit.
    if (entity.mover.target || entity.mover.holdPosition || entity.flight) {
      entity.mover.tactic = cloneTacticPlan(planSeed);
      assigned += 1;
    }
  }
  return assigned > 0;
}

/** Called when a unit arrives at its current move target while a tactic is active. */
export function advanceTacticAfterArrival(sim: GameSim, entity: Entity): void {
  const mover = entity.mover;
  if (!mover?.tactic) return;

  const plan = mover.tactic;
  if (plan.remaining.length > 0) {
    const next = plan.remaining.shift()!;
    issueMoveOrder(sim, [entity], next.x, next.z, false);
    if (entity.mover) entity.mover.tactic = plan;
    return;
  }

  const endAction = plan.endAction;
  mover.tactic = undefined;

  if (endAction.kind === 'attack-move') {
    mover.attackMove = true;
    return;
  }

  if (endAction.kind === 'attack') {
    const target = entityById(sim, endAction.targetId);
    if (!target || target.destroyed || !target.health || target.health.current <= 0) return;
    if (!entity.team || !target.team) return;
    if (!areTeamsHostile(sim, entity.team.id, target.team.id)) return;
    const destination = attackStandoffPoint(sim, [entity], target);
    if (!issueMoveOrder(sim, [entity], destination.x, destination.z, true)) return;
    if (entity.mover) entity.mover.attackTargetId = target.id;
  }
}
