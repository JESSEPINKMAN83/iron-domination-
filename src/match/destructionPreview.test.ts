import { describe, expect, it } from 'vitest';
import type { Entity } from '../sim/components';
import {
  destructionStageFromHealth,
  isDestructionPreviewQuery,
  livingPreviewAttackers,
  nextLivingBuilding,
} from './destructionPreview';

function building(id: number, current: number, destroyed = false): Entity {
  return {
    id,
    name: `Building ${id}`,
    transform: { x: id * 10, z: 0, rot: 0 },
    previousTransform: { x: id * 10, z: 0, rot: 0 },
    health: { current, max: 100 },
    building: { kind: 'barracks', label: `Barracks ${id}`, footprint: { w: 4, h: 4 }, powerProduced: 0, powerUsed: 0, complete: true, buildProgress: 1 },
    destroyed: destroyed ? { remaining: 20 } : undefined,
  };
}

describe('local destruction preview', () => {
  it('only treats the dedicated local query as a destruction range', () => {
    expect(isDestructionPreviewQuery(new URLSearchParams('destruction-preview=1'))).toBe(true);
    expect(isDestructionPreviewQuery(new URLSearchParams('destruction-preview=auto'))).toBe(true);
    expect(isDestructionPreviewQuery(new URLSearchParams('destruction-preview=0'))).toBe(false);
    expect(isDestructionPreviewQuery(new URLSearchParams('building-showcase=1'))).toBe(false);
  });

  it('names the ten visual damage stages from remaining health', () => {
    expect(destructionStageFromHealth(100, 100, false)).toEqual({ level: 0, label: 'Intact' });
    expect(destructionStageFromHealth(91, 100, false)).toEqual({ level: 1, label: 'Scorch' });
    expect(destructionStageFromHealth(45, 100, false)).toEqual({ level: 6, label: 'Open hole' });
    expect(destructionStageFromHealth(0, 100, true)).toEqual({ level: 10, label: 'Collapse' });
  });

  it('keeps firing the current building until it falls, then advances', () => {
    const a = building(1, 80);
    const b = building(2, 80);
    const c = building(3, 80);
    expect(nextLivingBuilding([a, b, c], a)).toBe(a);
    a.health!.current = 0;
    a.destroyed = { remaining: 20 };
    expect(nextLivingBuilding([a, b, c], a)).toBe(b);
    const attacker: Entity = {
      ...b,
      building: undefined,
      mover: { speed: 8, radius: 2 },
      weapon: { kind: 'tankMissile', cooldown: 0, range: 80 },
    };
    expect(livingPreviewAttackers([attacker, a]).map((entity) => entity.id)).toEqual([2]);
  });
});
