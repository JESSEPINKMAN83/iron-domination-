import { describe, expect, it } from 'vitest';
import { groundVehicleImpactPose } from './unitView';

describe('groundVehicleImpactPose', () => {
  it('rocks a surviving vehicle briefly and returns it exactly upright', () => {
    const weak = groundVehicleImpactPose(0.25, 0.3);
    const strong = groundVehicleImpactPose(1, 0.3);

    expect(weak.angle).toBeGreaterThan(0);
    expect(strong.angle).toBeGreaterThan(weak.angle);
    expect(strong.angle).toBeLessThanOrEqual(Math.PI / 15);
    expect(groundVehicleImpactPose(1, 0)).toEqual({ angle: 0, lift: 0 });
    expect(groundVehicleImpactPose(1, 1).angle).toBeCloseTo(0, 10);
    expect(groundVehicleImpactPose(1, 1).lift).toBeCloseTo(0, 10);
  });
});
