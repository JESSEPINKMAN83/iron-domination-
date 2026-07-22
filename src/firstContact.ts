import type { Entity } from './sim/components';

export type FirstContactCandidate = Pick<
  Entity,
  'team' | 'destroyed' | 'building' | 'selectable' | 'transform' | 'health'
>;

/** Keeps first contact strictly one-shot for the lifetime of a match. */
export class FirstContactGate {
  private triggered = false;

  tryTrigger(findContact: () => FirstContactCandidate | undefined): FirstContactCandidate | undefined {
    if (this.triggered) return undefined;
    const contact = findContact();
    if (contact) this.triggered = true;
    return contact;
  }

  triggerNow(): boolean {
    if (this.triggered) return false;
    this.triggered = true;
    return true;
  }
}

/** Returns the first live hostile unit or structure currently revealed to the player. */
export function findFirstVisibleHostileEntity(
  entities: Iterable<FirstContactCandidate>,
  localTeam: number,
  areHostile: (localTeam: number, otherTeam: number) => boolean,
  isVisible: (x: number, z: number) => boolean,
): FirstContactCandidate | undefined {
  for (const entity of entities) {
    const team = entity.team?.id;
    if (team === undefined || entity.destroyed || (entity.health && entity.health.current <= 0)) continue;
    if (!entity.selectable && !entity.building) continue;
    if (!areHostile(localTeam, team)) continue;
    if (!isVisible(entity.transform.x, entity.transform.z)) continue;
    return entity;
  }
  return undefined;
}
