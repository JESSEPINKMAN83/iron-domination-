import type { Entity } from '../sim/components';
import type { GameSim } from '../sim/world';

export class ControlGroups {
  private readonly groups = new Map<number, number[]>();

  assign(index: number, entities: Entity[], team: number): Entity[] {
    const members = eligibleMembers(entities, team);
    if (members.length === 0) this.groups.delete(index);
    else this.groups.set(index, members.map((entity) => entity.id));
    return members;
  }

  recall(index: number, sim: GameSim, team: number): Entity[] | undefined {
    const ids = this.groups.get(index);
    if (!ids) return undefined;
    const members = eligibleMembers(
      ids.map((id) => sim.byId.get(id)).filter((entity): entity is Entity => entity !== undefined),
      team,
    );
    if (members.length === 0) this.groups.delete(index);
    else this.groups.set(index, members.map((entity) => entity.id));
    return members;
  }
}

export function controlGroupIndex(code: string): number | undefined {
  const match = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  return match ? Number(match[1]) : undefined;
}

function eligibleMembers(entities: Entity[], team: number): Entity[] {
  const seen = new Set<number>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    return entity.team?.id === team && !!entity.selectable && !!entity.mover && !entity.destroyed && (entity.health?.current ?? 1) > 0;
  });
}
