import { describe, expect, it } from 'vitest';
import type { Entity } from '../sim/components';
import { unitDisplayName } from './unitDisplayName';

function unit(name: string, type: string, weapon: string): Entity {
  return {
    id: 1,
    name,
    transform: { x: 0, z: 0, rot: 0 },
    previousTransform: { x: 0, z: 0, rot: 0 },
    selectable: { selected: true, type, radius: 2 },
    weapon: { kind: weapon, range: 80, cooldown: 0 },
  } as Entity;
}

describe('unit display names', () => {
  it('replaces generated army identifiers with the canonical tank model', () => {
    expect(unitDisplayName(unit('Army 1 M-17 2', 'tank', 'tankMissile'))).toBe('M-17 Tank');
  });

  it('identifies the specific vehicle variant', () => {
    expect(unitDisplayName(unit('Army 1 Jackal 4', 'tank', 'scoutMissile'))).toBe('Jackal Scout');
    expect(unitDisplayName(unit('Army 1 Mauler 3', 'tank', 'siegeMissile'))).toBe('Mauler Siege');
  });

  it('keeps a meaningful custom name when no known unit model matches', () => {
    expect(unitDisplayName(unit('Spearhead', 'support-unit', 'unknown'))).toBe('Spearhead');
  });
});
