import { describe, expect, it } from 'vitest';
import { startPosition } from '../content/startPositions';
import { mapOrientationForPlayer } from './tacticPlanner';
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
