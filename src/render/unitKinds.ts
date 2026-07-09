import type { Entity } from '../sim/components';

export type UnitVisualKind = 'rifle' | 'grenadier' | 'rocket' | 'sniper' | 'jackal' | 'm17' | 'mauler' | 'wasp' | 'vulture' | 'hammerhead' | 'harvester';

export function unitVisualKind(entity: Entity): UnitVisualKind {
  if (entity.harvester || entity.selectable?.type === 'harvester') return 'harvester';
  const primary = entity.weapons?.primary.kind ?? entity.weapon?.kind;
  if (entity.selectable?.type === 'infantry') {
    if (primary === 'grenade') return 'grenadier';
    if (primary === 'rocketLauncher') return 'rocket';
    if (primary === 'sniperRifle') return 'sniper';
    return 'rifle';
  }
  if (entity.flight || entity.selectable?.type === 'vulture') {
    if (primary === 'waspAutocannon') return 'wasp';
    if (primary === 'agMissile') return 'hammerhead';
    return 'vulture';
  }
  if (entity.selectable?.type === 'tank') {
    if (primary === 'autocannon') return 'jackal';
    if (primary === 'heavyCannon') return 'mauler';
    return 'm17';
  }
  return 'm17';
}
