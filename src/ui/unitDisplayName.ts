import { unitLabel } from '../content/sideLabels';
import type { Entity } from '../sim/components';
import { unitKindForUpgrade } from '../sim/upgrades';

export function unitDisplayName(entity: Entity | undefined): string {
  if (!entity) return 'Unit';
  if (entity.harvester) return 'Ore Harvester';
  const kind = unitKindForUpgrade(entity);
  if (kind) return unitLabel(kind, entity.team?.id);
  return entity.name?.trim() || readableType(entity.selectable?.type);
}

function readableType(type: string | undefined): string {
  if (!type) return 'Unit';
  return type
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
