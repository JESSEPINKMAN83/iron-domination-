import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { projectBuildingHitBounds } from './buildingView';

describe('building screen selection bounds', () => {
  it('covers the complete visible building and adds a forgiving click margin', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    camera.position.set(0, 28, 42);
    camera.lookAt(0, 4, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const box = new Box3(new Vector3(-7, 0, -6), new Vector3(7, 12, 6));

    const bounds = projectBuildingHitBounds(box, camera, 1280, 720);

    expect(bounds).toBeDefined();
    expect(bounds!.left).toBeLessThan(bounds!.centerX);
    expect(bounds!.right).toBeGreaterThan(bounds!.centerX);
    expect(bounds!.top).toBeLessThan(bounds!.centerY);
    expect(bounds!.bottom).toBeGreaterThan(bounds!.centerY);
    expect(bounds!.right - bounds!.left).toBeGreaterThan(38);
    expect(bounds!.bottom - bounds!.top).toBeGreaterThan(38);
  });

  it('keeps distant small structures at least 38 pixels easy to select', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    camera.position.set(0, 80, 180);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const box = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 3, 1));

    const bounds = projectBuildingHitBounds(box, camera, 1280, 720);

    expect(bounds).toBeDefined();
    expect(bounds!.right - bounds!.left).toBeGreaterThanOrEqual(38);
    expect(bounds!.bottom - bounds!.top).toBeGreaterThanOrEqual(38);
  });
});
