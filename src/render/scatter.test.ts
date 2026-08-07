import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../sim/heightfield';
import { groundClutterTargetCount } from './scatter';

describe('ground clutter budget', () => {
  it('uses one tuft per 25 square metres without exceeding the 6000-instance budget', () => {
    expect(groundClutterTargetCount({ size: 100 } as Heightfield)).toBe(400);
    expect(groundClutterTargetCount({ size: 1024 } as Heightfield)).toBe(6000);
  });
});
