import { describe, expect, it } from 'vitest';
import { radarNorthDirection, radarPointerAction, radarToWorldPoint, worldToRadarPoint } from './radarTransform';

describe('camera-relative tactical radar transform', () => {
  it('puts camera-forward at the top and camera-right at the right at yaw zero', () => {
    expect(worldToRadarPoint(1000, 300, 300, 0, -500, 0)).toEqual({ x: 150, y: 0 });
    expect(worldToRadarPoint(1000, 300, 300, 500, 0, 0)).toEqual({ x: 300, y: 150 });
  });

  it('keeps screen directions intuitive after a ninety-degree camera rotation', () => {
    const yaw = Math.PI / 2;
    const cameraForward = worldToRadarPoint(1000, 300, 300, -500, 0, yaw);
    const cameraRight = worldToRadarPoint(1000, 300, 300, 0, -500, yaw);

    expect(cameraForward.x).toBeCloseTo(150, 8);
    expect(cameraForward.y).toBeCloseTo(0, 8);
    expect(cameraRight.x).toBeCloseTo(300, 8);
    expect(cameraRight.y).toBeCloseTo(150, 8);
  });

  it('round-trips desktop and mobile map coordinates at arbitrary camera angles', () => {
    for (const yaw of [0, 0.37, Math.PI / 2, -2.18]) {
      for (const point of [{ x: -280, z: 190 }, { x: 0, z: 0 }, { x: 342, z: -311 }]) {
        const radar = worldToRadarPoint(1000, 298, 298, point.x, point.z, yaw);
        const world = radarToWorldPoint(1000, 298, 298, radar.x, radar.y, yaw);
        expect(world.inside).toBe(true);
        expect(world.x).toBeCloseTo(point.x, 8);
        expect(world.z).toBeCloseTo(point.z, 8);
      }
    }
  });

  it('fits every rotated battlefield corner inside the radar', () => {
    const yaw = Math.PI / 4;
    for (const x of [-500, 500]) {
      for (const z of [-500, 500]) {
        const point = worldToRadarPoint(1000, 300, 300, x, z, yaw);
        expect(point.x).toBeGreaterThanOrEqual(-0.000001);
        expect(point.x).toBeLessThanOrEqual(300.000001);
        expect(point.y).toBeGreaterThanOrEqual(-0.000001);
        expect(point.y).toBeLessThanOrEqual(300.000001);
      }
    }
  });

  it('rotates the north indicator while keeping camera-up stable', () => {
    expect(radarNorthDirection(0)).toEqual({ x: -0, y: 1 });
    const eastFacing = radarNorthDirection(Math.PI / 2);
    expect(eastFacing.x).toBeCloseTo(-1, 8);
    expect(eastFacing.y).toBeCloseTo(0, 8);
  });

  it('maps desktop minimap buttons to camera, move, and Command ground-fire actions', () => {
    expect(radarPointerAction(0, false)).toBe('focus');
    expect(radarPointerAction(0, true)).toBe('focus');
    expect(radarPointerAction(2, false)).toBe('move');
    expect(radarPointerAction(2, true)).toBe('attack-ground');
    expect(radarPointerAction(1, false)).toBe('ignore');
  });
});
