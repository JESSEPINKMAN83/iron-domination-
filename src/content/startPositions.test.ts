import { describe, expect, it } from 'vitest';
import {
  SPAWN_EDGE_LIMIT,
  SPAWN_GRID,
  armyStartPosition,
  defaultSpawnPoints,
  sanitizeSpawnPoints,
  snapSpawnPoint,
  spawnPointsFromSlots,
  spawnPointsTooClose,
  startPosition,
} from './startPositions';

describe('spawn points', () => {
  it('falls back to the fixed corner when no custom point is set', () => {
    expect(armyStartPosition(1000, 2)).toEqual(startPosition(1000, 2));
  });

  it('places an army at its dragged position, scaled to map size', () => {
    const points = defaultSpawnPoints();
    points[0] = { x: 0.1, z: -0.2 };

    expect(armyStartPosition(1000, 1, points)).toEqual({ x: 100, z: -200 });
    // Untouched armies keep their corner.
    expect(armyStartPosition(1000, 2, points)).toEqual(startPosition(1000, 2));
  });

  it('snaps dragged positions onto the placement grid', () => {
    const snapped = snapSpawnPoint({ x: 0.1234, z: -0.0512 });

    expect(snapped.x).toBeCloseTo(0.12, 10);
    expect(snapped.z).toBeCloseTo(-0.06, 10);
    // Every snapped value is a whole number of grid steps from the centre.
    expect(Math.round(snapped.x / SPAWN_GRID)).toBe(6);
    expect(Math.round(snapped.z / SPAWN_GRID)).toBe(-3);
  });

  it('keeps positions inside the buildable edge margin', () => {
    expect(snapSpawnPoint({ x: 4, z: -9 })).toEqual({ x: SPAWN_EDGE_LIMIT, z: -SPAWN_EDGE_LIMIT });
  });

  it('rejects positions that would crowd another army', () => {
    expect(spawnPointsTooClose({ x: 0, z: 0 }, { x: 0.05, z: 0 })).toBe(true);
    expect(spawnPointsTooClose({ x: -0.34, z: -0.34 }, { x: 0.34, z: 0.34 })).toBe(false);
  });

  it('derives corner layouts from a slot assignment', () => {
    const swapped = spawnPointsFromSlots([2, 1, 3, 4]);

    expect(swapped[0]).toEqual({ x: 0.34, z: 0.34 });
    expect(swapped[1]).toEqual({ x: -0.34, z: -0.34 });
  });

  it('restores defaults for malformed stored values', () => {
    const parsed = sanitizeSpawnPoints([{ x: 0.2, z: 0.1 }, { x: 'nope' }, undefined, null]);

    expect(parsed?.[0]).toEqual({ x: 0.2, z: 0.1 });
    expect(parsed?.[1]).toEqual(defaultSpawnPoints()[1]);
    expect(parsed?.[3]).toEqual(defaultSpawnPoints()[3]);
    expect(sanitizeSpawnPoints('nonsense')).toBeUndefined();
  });
});
