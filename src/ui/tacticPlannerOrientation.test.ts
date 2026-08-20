import { describe, expect, it } from 'vitest';
import { startPosition } from '../content/startPositions';
import {
  MAX_TACTIC_START_DELAY_SECONDS,
  clampTacticStartDelaySeconds,
  formatTacticStartDelay,
  mapOrientationForPlayer,
} from './tacticPlanner';
import { worldToMapPercent } from './tacticalMap';

describe('tactic planner map orientation', () => {
  const worldSize = 400;

  it('puts team 1 (raw top-left) toward the bottom of the view', () => {
    const you = startPosition(worldSize, 1);
    const foe = startPosition(worldSize, 2);
    const { flipY } = mapOrientationForPlayer(worldSize, you, foe);
    const youY = flipY
      ? 100 - worldToMapPercent(worldSize, you.x, you.z).y
      : worldToMapPercent(worldSize, you.x, you.z).y;
    const foeY = flipY
      ? 100 - worldToMapPercent(worldSize, foe.x, foe.z).y
      : worldToMapPercent(worldSize, foe.x, foe.z).y;
    expect(youY).toBeGreaterThan(foeY);
    expect(youY).toBeGreaterThan(50);
  });

  it('keeps team 2 (raw bottom-right) toward the bottom without flipping away from the enemy', () => {
    const you = startPosition(worldSize, 2);
    const foe = startPosition(worldSize, 1);
    const { flipY } = mapOrientationForPlayer(worldSize, you, foe);
    const youY = flipY
      ? 100 - worldToMapPercent(worldSize, you.x, you.z).y
      : worldToMapPercent(worldSize, you.x, you.z).y;
    const foeY = flipY
      ? 100 - worldToMapPercent(worldSize, foe.x, foe.z).y
      : worldToMapPercent(worldSize, foe.x, foe.z).y;
    expect(youY).toBeGreaterThan(foeY);
    expect(youY).toBeGreaterThan(50);
  });
});

describe('tactic planner start delay', () => {
  it('clamps the countdown between immediate and five minutes', () => {
    expect(clampTacticStartDelaySeconds(-10)).toBe(0);
    expect(clampTacticStartDelaySeconds(75)).toBe(75);
    expect(clampTacticStartDelaySeconds(999)).toBe(MAX_TACTIC_START_DELAY_SECONDS);
    expect(clampTacticStartDelaySeconds(Number.NaN)).toBe(0);
  });

  it('formats the countdown as minutes and seconds', () => {
    expect(formatTacticStartDelay(0)).toBe('0:00');
    expect(formatTacticStartDelay(65)).toBe('1:05');
    expect(formatTacticStartDelay(300)).toBe('5:00');
  });
});
