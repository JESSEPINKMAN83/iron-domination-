import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { StructureDamage } from '../sim/components';
import {
  BUILDING_HEALTH_REVEAL_TICKS,
  blockDressKind,
  buildingHealthBarVisible,
  buildingSelectionFootprint,
  detailWoundFromGrid,
  projectBuildingHitBounds,
  pickBuildingGeometry,
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


describe('building geometry selection', () => {
  const camera = () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  };
  const building = (z = 0) => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(4, 4, 4), new MeshBasicMaterial()));
    root.position.z = z;
    root.updateMatrixWorld(true);
    return root;
  };
  it('selects the front surface when buildings overlap', () => {
    const back = building();
    const front = building(6);
    expect(pickBuildingGeometry([back, front], camera(), 300, 300, 600, 600)).toBe(front);
  });
  it('does not select empty space between a building and its antenna', () => {
    const root = building();
    const mast = new Mesh(new BoxGeometry(0.2, 5, 0.2), new MeshBasicMaterial());
    mast.position.set(5, 4, 0);
    root.add(mast);
    root.updateMatrixWorld(true);
    const c = camera();
    const empty = new Vector3(3.5, 3, 0).project(c);
    expect(pickBuildingGeometry([root], c, (empty.x + 1) * 300, (1 - empty.y) * 300, 600, 600)).toBeUndefined();
  });
  it('ignores hidden damage blocks and hidden buildings', () => {
    const root = building();
    root.children[0].visible = false;
    expect(pickBuildingGeometry([root], camera(), 300, 300, 600, 600)).toBeUndefined();
    root.children[0].visible = true;
    root.visible = false;
    expect(pickBuildingGeometry([root], camera(), 300, 300, 600, 600)).toBeUndefined();
  });
});


describe('partially occluded building selection', () => {
  it('selects the visible upper part of a rear building instead of the front building', () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const back = new Group();
    const rearMesh = new Mesh(new BoxGeometry(4, 8, 4), new MeshBasicMaterial());
    rearMesh.position.y = 2;
    back.add(rearMesh);
    const front = new Group();
    front.add(new Mesh(new BoxGeometry(4, 2, 4), new MeshBasicMaterial()));
    front.position.z = 6;
    back.updateMatrixWorld(true);
    front.updateMatrixWorld(true);
    const visibleRear = new Vector3(0, 4, 2).project(camera);
    expect(pickBuildingGeometry([front, back], camera, (visibleRear.x + 1) * 300, (1 - visibleRear.y) * 300, 600, 600)).toBe(back);
  });
});

describe('selection across building states and camera views', () => {
  for (const angle of [0, Math.PI / 3, Math.PI]) {
    for (const distance of [24, 90]) {
      for (const progress of [0.2, 1]) {
        it(`picks a visible surface at angle ${angle}, zoom ${distance}, construction ${progress}`, () => {
          const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
          camera.position.set(Math.sin(angle) * distance, distance * 0.7, Math.cos(angle) * distance);
          camera.lookAt(0, 1, 0);
          camera.updateMatrixWorld();
          const root = new Group();
          root.add(new Mesh(new BoxGeometry(8, 6, 8), new MeshBasicMaterial()));
          // A hidden removed block must not intercept clicks after damage.
          const removed = new Mesh(new BoxGeometry(10, 8, 10), new MeshBasicMaterial());
          removed.visible = false;
          root.add(removed);
          root.scale.y = progress;
          root.updateMatrixWorld(true);
          const center = new Vector3(0, 0, 0).project(camera);
          expect(pickBuildingGeometry([root], camera, (center.x + 1) * 300, (1 - center.y) * 300, 600, 600)).toBe(root);
        });
      }
    }
  }
});
