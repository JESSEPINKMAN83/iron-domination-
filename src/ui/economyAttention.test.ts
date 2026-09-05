import { describe, expect, it } from 'vitest';
import { economyAttention, ProductionIdleTracker } from './economyAttention';
import type { Entity } from '../sim/components';
import type { ResourceNode } from '../sim/world';

const collector = (state: 'seeking' | 'gathering', nodeId = 1) => ({
  transform: { x: 20, z: 30 }, harvester: { state, nodeId },
} as Entity);
const field = (id: number, remaining: number) => ({ id, capacity: 100, remaining, x: 40, z: 50 } as ResourceNode);

describe('economy attention', () => {
  it('locates idle collectors before flagging depleted fields', () => {
    expect(economyAttention([collector('seeking')], [field(1, 0)])).toEqual({
      text: '1 IDLE COLLECTOR · LOCATE', target: { x: 20, z: 30 },
    });
  });
  it('warns only for low fields assigned to our collectors', () => {
    expect(economyAttention([collector('gathering')], [field(1, 16), field(2, 1)]).text).toBe('');
    expect(economyAttention([collector('gathering')], [field(1, 15)]).target).toEqual({ x: 40, z: 50 });
    expect(economyAttention([], [field(1, 0)]).text).toBe('');
  });
  it('alerts once when a surviving producer becomes idle, not on startup or destruction', () => {
    const tracker = new ProductionIdleTracker();
    expect(tracker.update([{ id: 1, label: 'Factory', busy: false }])).toEqual([]);
    expect(tracker.update([{ id: 1, label: 'Factory', busy: true }])).toEqual([]);
    expect(tracker.update([{ id: 1, label: 'Factory', busy: false }])).toEqual(['Factory']);
    expect(tracker.update([{ id: 1, label: 'Factory', busy: false }])).toEqual([]);
    tracker.update([{ id: 2, label: 'Barracks', busy: true }]);
    expect(tracker.update([])).toEqual([]);
  });
});
