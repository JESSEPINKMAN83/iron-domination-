import { presetFormationOffsets, rotateFormationOffset } from './formations';
import { hash2i } from './noise';
import type { Entity, TacticEndAction, TacticPlan } from './components';
import { areTeamsHostile, attackStandoffPoint, entityById, issueMoveOrder, reserveUnitPosition, type GameSim } from './world';

export const MAX_TACTIC_WAYPOINTS = 64;

export function cloneTacticEndAction(endAction: TacticEndAction): TacticEndAction {
  if (endAction.kind === 'attack') return { kind: 'attack', targetId: endAction.targetId };
  return { kind: endAction.kind };
}

export function cloneTacticPlan(plan: TacticPlan): TacticPlan {
  return {
    remaining: plan.remaining.map((point) => ({ x: point.x, z: point.z })),
    endAction: cloneTacticEndAction(plan.endAction),
    sprint: plan.sprint,
    startAtTick: plan.startAtTick,
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
  if (endAction.kind === 'hold' || endAction.kind === 'attack-move' || endAction.kind === 'attack-through') return true;
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
  sprint = false,
  variation = 0,
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
    sprint: sprint || undefined,
  };

  if (!issueMoveOrder(sim, movers, first.x, first.z, false, undefined, undefined, sprint)) return false;

  const amount = Number.isFinite(variation) ? Math.max(0, Math.min(1, variation)) : 0;
  const ordered = [...movers].sort((a, b) => a.id - b.id);
  const spacing = Math.max(...ordered.map((entity) => entity.mover!.radius * 2 + 3));
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const preset = ordered[0].mover!.formationPreset;
  const center = ordered.reduce((p, unit) => ({ x: p.x + unit.transform.x / ordered.length, z: p.z + unit.transform.z / ordered.length }), { x: 0, z: 0 });
  const formationSlots = preset ? presetFormationOffsets(ordered.length, spacing, preset).map((slot) => rotateFormationOffset(slot, Math.atan2(first.x - center.x, first.z - center.z))) : undefined;
  let assigned = 0;
  for (const entity of movers) {
    if (!entity.mover) continue;
    // issueMoveOrder clears tactic; re-attach the shared remaining queue per unit.
    if (entity.mover.target || entity.mover.holdPosition || entity.flight) {
      const plan = cloneTacticPlan(planSeed);
      if (ordered.length > 1) {
        const index = ordered.indexOf(entity);
        const slot = { x: (index % columns - (columns - 1) / 2) * spacing, z: (Math.floor(index / columns) - (Math.ceil(ordered.length / columns) - 1) / 2) * spacing };
        const offset = (point: { x: number; z: number }, final: boolean, leg: number) => {
          // Low variation stays within a narrow corridor even in huge squads.
          // Also bound offsets by local leg length for tightly drawn routes.
          const previous = waypoints[Math.max(0, leg - 1)];
          const following = waypoints[Math.min(waypoints.length - 1, leg + 1)];
          const localLength = Math.min(
            leg > 0 ? Math.hypot(point.x - previous.x, point.z - previous.z) : Infinity,
            leg < waypoints.length - 1 ? Math.hypot(following.x - point.x, following.z - point.z) : Infinity,
          );
          const corridor = Math.min(spacing * amount * amount, Number.isFinite(localLength) ? localLength * 0.15 * amount : Infinity);
          const extent = Math.max(spacing, Math.hypot(slot.x, slot.z));
          const scale = final ? (entity.flight ? amount * amount : 1) : corridor / extent;
          const edge = sim.nav.size / 2 - entity.mover!.radius - 1;
          const formation = formationSlots?.[index];
          // Presets supply the safe baseline; variation adds a small route drift
          // rather than collapsing the wing back onto the centerline.
          const dx = formation ? formation.x + slot.x * scale * 0.25 : slot.x * scale;
          const dz = formation ? formation.z + slot.z * scale * 0.25 : slot.z * scale;
          return { x: Math.max(-edge, Math.min(edge, point.x + dx)), z: Math.max(-edge, Math.min(edge, point.z + dz)) };
        };
        plan.remaining = plan.remaining.map((point, index) => offset(point, index === plan.remaining.length - 1, index + 1));
        const firstPoint = offset(first, remaining.length === 0, 0);
        issueMoveOrder(sim, [entity], firstPoint.x, firstPoint.z, false, undefined, undefined, sprint);
        plan.startAtTick = sim.tick + Math.floor(hash2i(entity.id, sim.tick, 413) * amount * 60);
      }
      entity.mover.formationSlot = formationSlots?.[ordered.indexOf(entity)];
      entity.mover.tactic = plan;
      entity.mover.attackThrough = endAction.kind === 'attack-through' || undefined;
      entity.mover.engage = undefined;
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
    const slot = mover.formationSlot;
    issueMoveOrder(sim, [entity], next.x, next.z, false, undefined, undefined, !!plan.sprint);
    if (entity.mover) {
      entity.mover.formationSlot = slot;
      entity.mover.tactic = plan;
      entity.mover.attackThrough = plan.endAction.kind === 'attack-through' || undefined;
      entity.mover.engage = undefined;
    }
    return;
  }

  const endAction = plan.endAction;
  mover.tactic = undefined;

  if (entity.flight && (endAction.kind === 'hold' || endAction.kind === 'attack-through')) {
    const center = mover.holdPosition ?? entity.transform;
    const parking = reserveUnitPosition(sim, entity, center);
    if (Math.hypot(parking.x - center.x, parking.z - center.z) > 0.01) {
      issueMoveOrder(sim, [entity], parking.x, parking.z);
      // Preserve route-first firing while dispersing into parking slots.
      mover.attackThrough = endAction.kind === 'attack-through' || undefined;
    }
    return;
  }

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
