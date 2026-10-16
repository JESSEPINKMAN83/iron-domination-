import { describe, expect, it } from 'vitest';
import type { Entity } from '../sim/components';
import { groupOrderFeedback } from './orderFeedback';

const unit = (id: number): Entity => ({ id, previousTransform: { x: 0, z: 0, rot: 0 }, transform: { x: 0, z: 0, rot: 0 }, mover: { speed: 20, radius: 3 } });

describe('selected group order feedback', () => {
  it('reports firing while moving and the final route destination, not the current waypoint', () => {
    const aircraft = unit(1);
    aircraft.mover!.target = { x: 10, z: 20 };
    aircraft.mover!.attackThrough = true;
    aircraft.mover!.tactic = { remaining: [{ x: 100, z: 200 }], endAction: { kind: 'attack-through' } };
    aircraft.weapon = { kind: 'missile', range: 100, cooldown: 0, targetId: 9 };
    expect(groupOrderFeedback([aircraft], 10)).toEqual({ status: '1 moving · 1 attacking', mode: 'Attack as you move', destination: 'Destination 100, 200' });
  });

  it('distinguishes delayed departures from parked and counts mixed group states', () => {
    const waiting = unit(1), parked = unit(2), moving = unit(3);
    waiting.mover!.target = { x: 20, z: 20 };
    waiting.mover!.tactic = { startAtTick: 30, remaining: [], endAction: { kind: 'hold' } };
    moving.mover!.target = { x: 40, z: 40 };
    moving.mover!.aggressive = true;
    const result = groupOrderFeedback([waiting, parked, moving], 10);
    expect(result.status).toBe('1 moving · 1 parked · 1 waiting');
    expect(result.mode).toContain('Aggressive');
    expect(result.destination).toBe('Destination 30, 30 · 2 en route');
    expect(groupOrderFeedback([parked], 10).status).toBe('1 parked');
    expect(groupOrderFeedback([parked], 10).destination).toContain('holding position');
  });
});
