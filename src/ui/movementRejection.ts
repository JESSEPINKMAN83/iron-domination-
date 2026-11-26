import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';

// Local command feedback only; never serialized or used by the simulation.
const rejectedWater = new WeakMap<Entity, Pick<NonNullable<Entity['mover']>, 'target' | 'tactic' | 'attackTargetId'>>();

export function clearMovementRejections(units: readonly Entity[]): void {
  for (const unit of units) rejectedWater.delete(unit);
}

/** Aircraft may cross water; reject ground orders before the simulator snaps them ashore. */
export function filterWaterOrders(units: readonly Entity[], points: readonly { x: number; z: number }[], hf: Heightfield): Entity[] {
  const water = points.some(point => sampleHeight(hf, point.x, point.z) < hf.waterLevel + 0.25);
  const accepted: Entity[] = [];
  for (const unit of units) {
    if (water && unit.mover && !unit.flight && !unit.destroyed) {
      rejectedWater.set(unit, { target: unit.mover.target, tactic: unit.mover.tactic, attackTargetId: unit.mover.attackTargetId });
    } else {
      rejectedWater.delete(unit); accepted.push(unit);
    }
  }
  return accepted;
}

export function blockedRouteReason(unit: Entity): 'water' | 'unreachable' | undefined {
  if (!unit.mover || unit.destroyed || unit.flight) return undefined;
  const rejected = rejectedWater.get(unit), mover = unit.mover;
  if (rejected) {
    const sameRoute = rejected.tactic !== undefined && rejected.tactic === mover.tactic;
    const sameTargetOrArrived = rejected.target === mover.target || mover.target === undefined;
    const sameAttackOrFinished = rejected.attackTargetId === mover.attackTargetId || mover.attackTargetId === undefined;
    if ((sameRoute || (mover.tactic === undefined && sameTargetOrArrived)) && sameAttackOrFinished) return 'water';
    rejectedWater.delete(unit);
  }
  if (mover.target && mover.flow) {
    const cell = mover.flow.grid.worldToCell(unit.transform.x, unit.transform.z);
    if (mover.flow.distance[mover.flow.grid.index(cell.x, cell.y)] < 0) return 'unreachable';
  }
  return undefined;
}
