import { describe, expect, it } from 'vitest';
import { trailEmissionCount } from './groundTrailView';

describe('tank tread trail sampling', () => {
  it('waits until a vehicle has travelled one sample spacing', () => {
    expect(trailEmissionCount(0.8, 1.05)).toBe(0);
    expect(trailEmissionCount(1.05, 1.05)).toBe(1);
  });

  it('caps catch-up work after a teleport or stalled frame', () => {
    expect(trailEmissionCount(40, 1.05)).toBe(3);
  });

  it('rejects invalid distances and spacing', () => {
    expect(trailEmissionCount(Number.NaN, 1)).toBe(0);
    expect(trailEmissionCount(2, 0)).toBe(0);
  });
});
