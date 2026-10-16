import type { Entity } from '../sim/components';

/** Describe navigation and firing independently: a moving unit can also be attacking. */
export function groupOrderFeedback(units: Entity[], tick: number): { status: string; mode: string; destination: string } {
  const movers = units.filter((unit) => unit.mover && !unit.building && !unit.harvester && !unit.destroyed);
  let moving = 0, attacking = 0, parked = 0, waiting = 0;
  const modes = new Set<string>();
  const destinations: Array<{ x: number; z: number }> = [];
  for (const unit of movers) {
    const mover = unit.mover!;
    const firing = [unit.weapon, unit.weapons?.primary, unit.weapons?.secondary].some((weapon) => weapon?.targetId !== undefined);
    if (firing) attacking++;
    if ((mover.tactic?.startAtTick ?? 0) > tick) waiting++;
    else if (mover.target || mover.engage) moving++;
    else parked++;
    const action = mover.tactic?.endAction;
    const mode = mover.attackThrough || action?.kind === 'attack-through' ? 'Attack as you move'
      : mover.aggressive ? 'Aggressive' : mover.attackTargetId || action?.kind === 'attack' ? 'Attack target'
        : mover.attackMove || action?.kind === 'attack-move' ? 'Attack move' : mover.target ? 'Move' : 'Hold';
    modes.add(`${mode}${mover.sprint && mover.target ? ' · Fast' : ''}`);
    const final = mover.tactic?.remaining.at(-1) ?? mover.target;
    if (final) destinations.push({ x: final.x + (mover.formationOffset?.x ?? 0), z: final.z + (mover.formationOffset?.z ?? 0) });
  }
  const counts = [[moving, 'moving'], [attacking, 'attacking'], [parked, 'parked'], [waiting, 'waiting']] as const;
  const status = counts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join(' · ');
  const center = destinations.reduce((p, point) => ({ x: p.x + point.x / destinations.length, z: p.z + point.z / destinations.length }), { x: 0, z: 0 });
  return { status, mode: [...modes].join(' / '), destination: destinations.length ? `Destination ${Math.round(center.x)}, ${Math.round(center.z)}${destinations.length < movers.length ? ` · ${destinations.length} en route` : ''}` : 'Destination reached / holding position' };
}
