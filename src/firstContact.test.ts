import { describe, expect, it, vi } from 'vitest';
import { FirstContactGate, findFirstVisibleHostileEntity, type FirstContactCandidate } from './firstContact';

function candidate(overrides: Partial<FirstContactCandidate> = {}): FirstContactCandidate {
  return {
    team: { id: 2 },
    transform: { x: 20, z: 30, rot: 0 },
    selectable: { selected: false, type: 'tank', radius: 2 },
    health: { current: 100, max: 100 },
    ...overrides,
  };
}

describe('first enemy contact', () => {
  it('returns the first visible live hostile unit', () => {
    const hidden = candidate({ transform: { x: 10, z: 10, rot: 0 } });
    const visible = candidate({ transform: { x: 40, z: 40, rot: 0 } });
    const result = findFirstVisibleHostileEntity(
      [hidden, visible],
      1,
      (_local, other) => other === 2,
      (x) => x === 40,
    );

    expect(result).toBe(visible);
  });

  it('ignores allies, defeated entities, and non-unit simulation objects', () => {
    const visible = vi.fn(() => true);
    const result = findFirstVisibleHostileEntity(
      [
        candidate({ team: { id: 1 } }),
        candidate({ destroyed: { remaining: 5 } }),
        candidate({ health: { current: 0, max: 100 } }),
        candidate({ selectable: undefined, building: undefined }),
      ],
      1,
      (local, other) => local !== other,
      visible,
    );

    expect(result).toBeUndefined();
    expect(visible).not.toHaveBeenCalled();
  });

  it('recognizes a visible hostile structure as contact', () => {
    const structure = candidate({
      selectable: undefined,
      building: {
        kind: 'command-yard',
        label: 'Command Yard',
        footprint: { w: 12, h: 12 },
        powerProduced: 0,
        powerUsed: 0,
        complete: true,
        buildProgress: 1,
      },
    });

    expect(findFirstVisibleHostileEntity([structure], 1, () => true, () => true)).toBe(structure);
  });

  it('can only trigger once even when another army is discovered later', () => {
    const gate = new FirstContactGate();
    const firstArmy = candidate({ team: { id: 2 } });
    const secondArmy = candidate({ team: { id: 3 } });
    const laterFinder = vi.fn(() => secondArmy);

    expect(gate.tryTrigger(() => firstArmy)).toBe(firstArmy);
    expect(gate.tryTrigger(laterFinder)).toBeUndefined();
    expect(laterFinder).not.toHaveBeenCalled();
  });
});
