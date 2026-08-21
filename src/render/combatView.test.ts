import { describe, expect, it } from 'vitest';
import { Sprite } from 'three';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from '../sim/heightfield';
import type { CombatEvent } from '../sim/world';
import { CombatView, selectCombatVisualEvents } from './combatView';

function event(index: number, sourceTeamId: number, overrides: Partial<CombatEvent> = {}): CombatEvent {
  return {
    kind: 'rifle',
    fromX: index,
    fromZ: 0,
    toX: index + 1,
    toZ: 1,
    sourceTeamId,
    damage: 4,
    killed: false,
    ...overrides,
  };
}

describe('combat visual load shedding', () => {
  it('keeps ordinary battles intact', () => {
    const events = Array.from({ length: 12 }, (_, index) => event(index, (index % 3) + 1));
    expect(selectCombatVisualEvents(events, 1, 0)).toEqual(events);
  });

  it('bounds a three-army event storm while reserving local and critical feedback', () => {
    const events = [
      ...Array.from({ length: 30 }, (_, index) => event(index, 2, { killed: true })),
      ...Array.from({ length: 120 }, (_, index) => event(100 + index, 1)),
      ...Array.from({ length: 150 }, (_, index) => event(300 + index, index % 2 === 0 ? 2 : 3)),
    ];

    const selected = selectCombatVisualEvents(events, 1, 0);
    expect(selected).toHaveLength(48);
    expect(selected.filter((candidate) => candidate.killed)).toHaveLength(12);
    expect(selected.filter((candidate) => !candidate.killed && candidate.sourceTeamId === 1)).toHaveLength(24);
    expect(selected.some((candidate) => candidate.sourceTeamId === 2 || candidate.sourceTeamId === 3)).toBe(true);
    expect(selected.map((candidate) => candidate.fromX)).toEqual(
      [...selected].sort((a, b) => a.fromX - b.fromX).map((candidate) => candidate.fromX),
    );
  });

  it('tightens the allocation ceiling as adaptive quality drops', () => {
    const events = Array.from({ length: 200 }, (_, index) => event(index, (index % 3) + 1));
    expect(selectCombatVisualEvents(events, 1, 0)).toHaveLength(48);
    expect(selectCombatVisualEvents(events, 1, 1)).toHaveLength(34);
    expect(selectCombatVisualEvents(events, 1, 2)).toHaveLength(22);
    expect(selectCombatVisualEvents(events, 1, 0, 7)).toHaveLength(7);
    expect(selectCombatVisualEvents(events, 1, 0, 0)).toEqual([]);
  });

  it('ignores non-visual bookkeeping before applying the budget', () => {
    const bookkeeping = Array.from({ length: 100 }, (_, index) => event(index, 1, { kind: 'impact-reaction' }));
    bookkeeping.push(event(150, 2, { kind: 'strategic-missile-warning', targetTeamId: 1 }));
    const visible = Array.from({ length: 8 }, (_, index) => event(200 + index, 1));
    expect(selectCombatVisualEvents([...bookkeeping, ...visible], 1, 0)).toEqual(visible);
  });

  it('shows and updates strategic missile health for every player viewing the missile', () => {
    const view = new CombatView(generateHeightfield(MAP01), () => true, () => undefined, 2);
    view.push([event(0, 1, {
      kind: 'siegeMissile',
      weaponKind: 'strategicMissile',
      targetTeamId: 2,
      strategicId: 42,
      targetHealth: 100,
      targetMaxHealth: 100,
      trajectory: 'arc',
      duration: 8,
      damage: 0,
    })]);
    const sprites: Sprite[] = [];
    view.group.traverse((object) => {
      if (object instanceof Sprite) sprites.push(object);
    });
    const fill = sprites.find((sprite) => sprite.renderOrder === 91);
    expect(fill?.scale.x).toBeCloseTo(8.1);

    view.push([event(1, 2, {
      kind: 'impact-reaction',
      strategicId: 42,
      targetHealth: 40,
      targetMaxHealth: 100,
      damage: 20,
    })]);
    expect(fill?.scale.x).toBeCloseTo(3.24);

    const attackerView = new CombatView(generateHeightfield(MAP01), () => true, () => undefined, 1);
    attackerView.push([event(0, 1, {
      kind: 'siegeMissile',
      weaponKind: 'strategicMissile',
      targetTeamId: 2,
      strategicId: 43,
      targetHealth: 100,
      targetMaxHealth: 100,
      trajectory: 'arc',
      duration: 8,
      damage: 0,
    })]);
    const attackerSprites: Sprite[] = [];
    attackerView.group.traverse((object) => {
      if (object instanceof Sprite) attackerSprites.push(object);
    });
    expect(attackerSprites.some((sprite) => sprite.renderOrder === 91)).toBe(true);
  });
});
