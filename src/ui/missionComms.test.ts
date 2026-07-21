import { describe, expect, it } from 'vitest';
import { firstVisibleHostile } from './missionComms';
import type { Entity } from '../sim/components';

function entity(team: number, x: number, options: Partial<Entity> = {}): Entity {
  return {
    id: x + 100,
    transform: { x, y: 0, z: 0, rot: 0 },
    previousTransform: { x, y: 0, z: 0, rot: 0 },
    team: { id: team },
    selectable: { selected: false, type: 'tank', radius: 2 },
    ...options,
  };
}

describe('firstVisibleHostile', () => {
  it('ignores allies, destroyed units, and hostiles outside vision', () => {
    const target = entity(2, 25);
    expect(firstVisibleHostile(
      [entity(1, 1), entity(2, 5, { destroyed: { remaining: 1 } }), entity(2, 12), target],
      (team) => team === 2,
      (x) => x >= 20,
    )).toBe(target);
  });

  it('accepts a visible hostile building', () => {
    const target = entity(3, 40, {
      selectable: undefined,
      building: {
        kind: 'barracks',
        label: 'Barracks',
        footprint: { w: 8, h: 8 },
        powerProduced: 0,
        powerUsed: 5,
        complete: true,
        buildProgress: 1,
      },
    });
    expect(firstVisibleHostile([target], (team) => team === 3, () => true)).toBe(target);
  });
});
