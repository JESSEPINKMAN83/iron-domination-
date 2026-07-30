import { describe, expect, it } from 'vitest';
import { VEGETATION_COUNTS } from './scatter';

function treeTotal(kind: keyof typeof VEGETATION_COUNTS): number {
  const counts = VEGETATION_COUNTS[kind];
  return Object.entries(counts)
    .filter(([name]) => !name.toLowerCase().includes('shrub') && !name.toLowerCase().includes('log'))
    .reduce((total, [, count]) => total + count, 0);
}

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
