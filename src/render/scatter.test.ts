import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../sim/heightfield';
import {
  CRUSHED_VEGETATION_FADE_SECONDS,
  CRUSHED_VEGETATION_HOLD_SECONDS,
  crushedVegetationOpacity,
  groundClutterTargetCount,
  VEGETATION_COUNTS,
} from './scatter';

function treeTotal(kind: keyof typeof VEGETATION_COUNTS): number {
  const counts = VEGETATION_COUNTS[kind];
  return Object.entries(counts)
    .filter(([name]) => !name.toLowerCase().includes('shrub') && !name.toLowerCase().includes('log'))
    .reduce((total, [, count]) => total + count, 0);
}

describe('ground clutter budget', () => {
  it('uses one tuft per 25 square metres without exceeding the 6000-instance budget', () => {
    expect(groundClutterTargetCount({ size: 100 } as Heightfield)).toBe(400);
    expect(groundClutterTargetCount({ size: 1024 } as Heightfield)).toBe(6000);
  });
});

describe('crushed vegetation lifecycle', () => {
  it('holds for ten seconds, fades for five, then disappears', () => {
    expect(CRUSHED_VEGETATION_HOLD_SECONDS).toBe(10);
    expect(CRUSHED_VEGETATION_FADE_SECONDS).toBe(5);
    expect(crushedVegetationOpacity(9.99)).toBe(1);
    expect(crushedVegetationOpacity(10)).toBe(1);
    expect(crushedVegetationOpacity(12.5)).toBeCloseTo(0.5);
    expect(crushedVegetationOpacity(15)).toBe(0);
    expect(crushedVegetationOpacity(30)).toBe(0);
  });
});

describe('map vegetation profiles', () => {
  it('reduces Highlands tree density while expanding silhouette variety', () => {
    expect(treeTotal('highlands')).toBeLessThan(2300);
    expect(Object.keys(VEGETATION_COUNTS.highlands)).toEqual(
      expect.arrayContaining(['spruce', 'pine', 'broadleaf', 'birch', 'snag', 'shrub', 'fallenLog']),
    );
  });

  it('uses lighter map-specific vegetation totals for arid and frozen maps', () => {
    expect(treeTotal('crater-oasis')).toBeLessThan(600);
    expect(treeTotal('frostbite-pass')).toBeLessThan(1200);
    expect(VEGETATION_COUNTS['crater-oasis'].acacia).toBeGreaterThan(0);
    expect(VEGETATION_COUNTS['frostbite-pass'].spruce).toBeGreaterThan(0);
  });
});
