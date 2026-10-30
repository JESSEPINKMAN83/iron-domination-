import { describe, expect, it } from 'vitest';
import { SpatialHash } from './spatialHash';

interface Point {
  id: number;
  side: number;
  transform: { x: number; z: number };
}

const point = (id: number, side: number, x: number, z: number): Point => ({ id, side, transform: { x, z } });

describe('SpatialHash', () => {
  const items = [point(1, 1, 5, 5), point(2, 1, 8, 2), point(3, 2, 60, 5), point(4, 1, 62, 9), point(5, 3, -40, -40)];

  it('visits nearby buckets in stable row order', () => {
    const grid = new SpatialHash<Point>(48);
    grid.rebuild(items);
    const all: number[] = [];
    grid.visitNearby(0, 0, 100, (item) => all.push(item.id));
    expect(all).toEqual([5, 1, 2, 3, 4]);
    const none: number[] = [];
    grid.visitNearby(900, 900, 40, (item) => none.push(item.id));
    expect(none).toEqual([]);
  });

  it('skips cells whose side mask has nothing wanted, and ignores masks after a plain rebuild', () => {
    const grid = new SpatialHash<Point>(48);
    grid.rebuild(items, (item) => 1 << item.side);
    const visited: number[] = [];
    grid.visitNearestMasked(0, 0, 100, ~(1 << 1), (item) => visited.push(item.id), () => Number.POSITIVE_INFINITY);
    // The side-1-only cell is skipped; mixed cells keep their side-1 members.
    expect(visited.sort((a, b) => a - b)).toEqual([3, 4, 5]);
    grid.rebuild(items);
    const unmasked: number[] = [];
    grid.visitNearestMasked(0, 0, 100, 0, (item) => unmasked.push(item.id), () => Number.POSITIVE_INFINITY);
    expect(unmasked.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('nearest-first visits every wanted item within the radius and the moving limit', () => {
    let seed = 7;
    const next = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const scattered = Array.from({ length: 400 }, (_, i) => point(i, 1 + (i % 4), (next() - 0.5) * 600, (next() - 0.5) * 600));
    const grid = new SpatialHash<Point>(48);
    grid.rebuild(scattered, (item) => 1 << item.side);
    for (let q = 0; q < 60; q++) {
      const x = (next() - 0.5) * 500, z = (next() - 0.5) * 500, radius = 40 + next() * 200;
      const wanted = ~(1 << (1 + (q % 4)));
      // Nearest wanted item, found the cheap way, must match brute force.
      let best: Point | undefined;
      let bestD = Number.POSITIVE_INFINITY;
      grid.visitNearestMasked(x, z, radius, wanted, (item) => {
        if (((1 << item.side) & wanted) === 0) return;
        const d = Math.hypot(item.transform.x - x, item.transform.z - z);
        if (d <= radius && (d < bestD || (d === bestD && item.id < best!.id))) { best = item; bestD = d; }
      }, () => bestD);
      const expected = scattered
        .filter((item) => ((1 << item.side) & wanted) !== 0)
        .map((item) => ({ item, d: Math.hypot(item.transform.x - x, item.transform.z - z) }))
        .filter(({ d }) => d <= radius)
        .sort((a, b) => a.d - b.d || a.item.id - b.item.id)[0]?.item;
      expect(best?.id).toBe(expected?.id);
    }
  });
});
