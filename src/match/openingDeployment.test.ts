import { describe, expect, it } from 'vitest';
import { openingFormationBasis, openingFormationPoint, openingStagingDepth } from './openingDeployment';

describe('opening deployment', () => {
  it('keeps the normal small-base formation at its familiar distance', () => {
    const basis = openingFormationBasis(1);
    const depth = openingStagingDepth(0, 0, basis, [{ x: 0, z: 0, radius: 18 }]);

    expect(depth).toBe(29);
  });

  it('stages units beyond the outer edge of a prebuilt demo base', () => {
    const basis = openingFormationBasis(1);
    const obstacles = [
      { x: 0, z: 0, radius: 18 },
      { x: 34, z: 32, radius: 22 },
      { x: 10, z: 62, radius: 19 },
    ];
    const depth = openingStagingDepth(0, 0, basis, obstacles);
    const point = openingFormationPoint(0, 0, basis, 0, depth);

    for (const obstacle of obstacles) {
      const projection = obstacle.x * basis.forwardX + obstacle.z * basis.forwardZ;
      expect(depth).toBeGreaterThanOrEqual(projection + obstacle.radius + 9);
    }
    expect(Math.hypot(point.x, point.z)).toBeCloseTo(depth, 8);
    expect(depth).toBeGreaterThan(70);
  });

  it('stages each army toward its own outward map quadrant', () => {
    expect(openingFormationBasis(1).forwardX).toBeGreaterThan(0);
    expect(openingFormationBasis(1).forwardZ).toBeGreaterThan(0);
    expect(openingFormationBasis(2).forwardX).toBeLessThan(0);
    expect(openingFormationBasis(2).forwardZ).toBeLessThan(0);
    expect(openingFormationBasis(3).forwardX).toBeLessThan(0);
    expect(openingFormationBasis(3).forwardZ).toBeGreaterThan(0);
    expect(openingFormationBasis(4).forwardX).toBeGreaterThan(0);
    expect(openingFormationBasis(4).forwardZ).toBeLessThan(0);
  });
});
