import { describe, expect, it } from 'vitest';
import type { Entity } from '../sim/components';
import type { CombatEvent } from '../sim/world';
import { BaseUnderAttackGate, findFriendlyBuildingUnderAttack } from './baseUnderAttack';

function building(id: number, team: number, kind: string, label: string, health = 500): Entity {
  return {
    id,
    name: label,
    transform: { x: id * 10, z: 0, rot: 0 },
    previousTransform: { x: id * 10, z: 0, rot: 0 },
    health: { current: health, max: 500 },
    team: { id: team },
    building: {
      kind,
      label,
      footprint: { w: 8, h: 8 },
      powerProduced: 0,
      powerUsed: 0,
      complete: true,
      buildProgress: 1,
    },
  } as Entity;
}

function hit(targetId: number, damage: number, extras: Partial<CombatEvent> = {}): CombatEvent {
  return {
    kind: 'cannon',
    fromX: 0,
    fromZ: 0,
    toX: 0,
    toZ: 0,
    targetId,
    targetType: 'building',
    damage,
    killed: false,
    ...extras,
  };
}

describe('findFriendlyBuildingUnderAttack', () => {
  it('ignores enemy structures, units, and zero-damage events', () => {
    const yard = building(1, 1, 'command-yard', 'Command Yard');
    const enemy = building(2, 2, 'factory', 'Factory');
    const byId = new Map<number, Entity>([
      [1, yard],
      [2, enemy],
      [3, { ...building(3, 1, 'barracks', 'Barracks'), building: undefined } as Entity],
    ]);

    expect(findFriendlyBuildingUnderAttack([
      hit(2, 40),
      hit(3, 20, { targetType: 'tank' }),
      hit(1, 0),
    ], byId, 1)).toBeUndefined();
  });

  it('returns the friendly building hit and prefers the command yard', () => {
    const yard = building(1, 1, 'command-yard', 'Command Yard');
    const plant = building(4, 1, 'power-plant', 'Power Plant');
    const byId = new Map<number, Entity>([
      [1, yard],
      [4, plant],
    ]);

    expect(findFriendlyBuildingUnderAttack([hit(4, 80), hit(1, 12)], byId, 1)).toEqual({
      x: 10,
      z: 0,
      label: 'Command Yard',
      critical: true,
    });
  });

  it('marks low-hull structures as critical', () => {
    const plant = building(5, 1, 'power-plant', 'Power Plant', 100);
    const byId = new Map<number, Entity>([[5, plant]]);
    expect(findFriendlyBuildingUnderAttack([hit(5, 40)], byId, 1)?.critical).toBe(true);
  });
});

describe('BaseUnderAttackGate', () => {
  it('fires once then cools down', () => {
    const gate = new BaseUnderAttackGate(90);
    const alert = { x: 1, z: 2, label: 'Refinery', critical: false };
    expect(gate.tryTrigger(10, () => alert)).toEqual(alert);
    expect(gate.tryTrigger(50, () => alert)).toBeUndefined();
    expect(gate.tryTrigger(100, () => alert)).toEqual(alert);
  });
});
