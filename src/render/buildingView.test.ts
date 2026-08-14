import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { StructureDamage } from '../sim/components';
import {
  BUILDING_HEALTH_REVEAL_TICKS,
  blockDressKind,
  buildingHealthBarVisible,
  buildingSelectionFootprint,
  detailWoundFromGrid,
  projectBuildingHitBounds,
} from './buildingView';

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

describe('building damage dressing ladder', () => {
  it('escalates from scorch to a missing cell as local damage grows', () => {
    expect(blockDressKind(0, 0)).toBe('intact');
    expect(blockDressKind(8, 1)).toBe('scorched');
    expect(blockDressKind(24, 2)).toBe('cracked');
    expect(blockDressKind(70, 4)).toBe('shrunk');
    expect(blockDressKind(140, 6)).toBe('rubble');
    expect(blockDressKind(200, 8)).toBe('removed');
    expect(blockDressKind(90, 8, true)).toBe('rubble');
  });

  it('wounds details on the struck facade harder than the opposite face', () => {
    const damage: StructureDamage = {
      cols: 4,
      rows: 3,
      tiers: 2,
      cells: new Uint8Array(24),
      version: 1,
    };
    damage.cells[0] = 160;
    const west = detailWoundFromGrid(damage, -8, 2, 0, 16, 12, 6);
    const east = detailWoundFromGrid(damage, 8, 2, 0, 16, 12, 6);
    expect(west).toBeGreaterThan(east);
    expect(west).toBeGreaterThanOrEqual(160);
  });
});

describe('building selection footprint', () => {
  it('follows the rectangular ground contact instead of a circumcircle', () => {
    const cellSize = 2;
    const yard = buildingSelectionFootprint({ w: 5, h: 5 }, cellSize, 'command-yard');
    const factory = buildingSelectionFootprint({ w: 8, h: 7 }, cellSize, 'factory');
    const oldCircle = Math.hypot(5 * cellSize, 5 * cellSize);

    expect(yard.wallHalfW).toBeCloseTo(yard.wallHalfD, 5);
    expect(yard.ringHalfW).toBeLessThan(oldCircle);
    expect(factory.wallHalfW / factory.wallHalfD).toBeCloseTo(8 / 7, 2);
    expect(factory.ringHalfW).toBeGreaterThan(yard.ringHalfW);
    expect(yard.ringHalfW - yard.wallHalfW).toBeLessThan(1.2);
    expect(yard.ringWidth).toBeCloseTo(0.51, 2);
  });

  it('keeps wall-base lights just outside the visual foundation', () => {
    const tower = buildingSelectionFootprint({ w: 4, h: 4 }, 2, 'guard-tower');
    const yard = buildingSelectionFootprint({ w: 5, h: 5 }, 2, 'command-yard');
    expect(tower.wallHalfW).toBeLessThan(yard.wallHalfW);
    expect(tower.skirtHeight).toBeGreaterThan(0.3);
    expect(yard.ringHalfW).toBeGreaterThan(yard.wallHalfW);
  });
});

describe('building health bar visibility', () => {
  const hidden = {
    fogged: false,
    destroyed: false,
    selected: false,
    hovered: false,
    pct: 1,
    ticksSinceDamage: 999,
  };

  it('stays hidden on a healthy building until hover, selection, or damage', () => {
    expect(buildingHealthBarVisible(hidden)).toBe(false);
    expect(buildingHealthBarVisible({ ...hidden, hovered: true })).toBe(true);
    expect(buildingHealthBarVisible({ ...hidden, selected: true })).toBe(true);
    expect(buildingHealthBarVisible({ ...hidden, pct: 0.8 })).toBe(true);
    expect(buildingHealthBarVisible({ ...hidden, ticksSinceDamage: 12 })).toBe(true);
  });

  it('never leaks health through fog or after the building is gone', () => {
    expect(buildingHealthBarVisible({ ...hidden, hovered: true, fogged: true, pct: 0.2 })).toBe(false);
    expect(buildingHealthBarVisible({ ...hidden, selected: true, destroyed: true })).toBe(false);
    expect(buildingHealthBarVisible({ ...hidden, ticksSinceDamage: BUILDING_HEALTH_REVEAL_TICKS + 1 })).toBe(false);
  });
});
