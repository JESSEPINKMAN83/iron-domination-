import { describe, expect, it } from 'vitest';
import { MAP_PRESETS } from '../content/maps';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim, spawnTankAt } from '../sim/world';
import { ControlGroups, controlGroupIndex } from './controlGroups';

describe('RTS control groups', () => {
  it('maps number-row and numeric-keypad keys to groups 0 through 9', () => {
    expect(controlGroupIndex('Digit0')).toBe(0);
    expect(controlGroupIndex('Digit9')).toBe(9);
    expect(controlGroupIndex('Numpad3')).toBe(3);
    expect(controlGroupIndex('Key3')).toBeUndefined();
  });

  it('stores friendly units by id and prunes destroyed or enemy members on recall', () => {
    const hf = generateHeightfield({ ...MAP_PRESETS.highlands.config, cells: 64, oreFieldCount: 3 });
    const sim = createGameSim(hf);
    const first = spawnTankAt(sim, -12, -12, 'First', 1);
    const second = spawnTankAt(sim, -6, -12, 'Second', 1);
    const enemy = spawnTankAt(sim, 12, 12, 'Enemy', 2);
    const groups = new ControlGroups();

    expect(groups.assign(4, [first, second, enemy], 1)).toEqual([first, second]);
    second.destroyed = { remaining: 20 };
    expect(groups.recall(4, sim, 1)).toEqual([first]);
  });

  it('clears a group when assigned with no eligible units', () => {
    const hf = generateHeightfield({ ...MAP_PRESETS.highlands.config, cells: 64, oreFieldCount: 3 });
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Tank', 1);
    const groups = new ControlGroups();

    groups.assign(1, [tank], 1);
    groups.assign(1, [], 1);
    expect(groups.recall(1, sim, 1)).toBeUndefined();
  });
});
