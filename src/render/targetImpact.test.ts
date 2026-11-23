import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Matrix4, Object3D, Vector3 } from 'three';
import { DamagedHullBatch } from './damagedHullBatch';
import { ImpactDebrisView } from './impactDebris';
import { positionUnitScar, UnitImpactScars } from './unitImpactScars';

describe('damaged hull batching', () => {
  it('preserves every cell transform, geometry and material while reducing submissions', () => {
    const box = new BoxGeometry(), rubble = new BoxGeometry(0.8, 0.5, 0.9);
    const concrete = new MeshBasicMaterial(), char = new MeshBasicMaterial({ color: 0x222222 });
    const cells = Array.from({ length: 32 }, (_, i) => {
      const cell = new Mesh(i > 27 ? rubble : box, i % 4 ? concrete : char);
      cell.position.set(i % 4, Math.floor(i / 4), i * 0.1); cell.rotation.y = i * 0.03; cell.scale.set(1, 0.7, 1);
      return cell;
    });
    const batch = new DamagedHullBatch(32); batch.sync(cells);
    expect(batch.root.children.length).toBeLessThanOrEqual(4);
    const actual: number[][] = [];
    for (const child of batch.root.children) {
      const mesh = child as import('three').InstancedMesh;
      const matrix = new Matrix4();
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); actual.push([...matrix.elements]); }
    }
    expect(actual).toHaveLength(32);
    for (const cell of cells) { cell.updateMatrix(); expect(actual.some((m) => m.every((value, i) => Math.abs(value - cell.matrix.elements[i]) < 1e-6))).toBe(true); }
    const geometryDispose = vi.spyOn(box, 'dispose'), materialDispose = vi.spyOn(concrete, 'dispose');
    cells.forEach((c) => { c.visible = false; }); batch.sync(cells);
    expect(batch.root.children).toHaveLength(0);
    batch.dispose(); expect(geometryDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
    box.dispose(); rubble.dispose(); concrete.dispose(); char.dispose();
  });
});

describe('bounded impact debris', () => {
  const chip = { x: 0, y: 2, z: 0, ground: 0, angle: 0, speed: 4, lift: 1, size: 0.2, lifetime: 1, seed: 1, masonry: true, spark: false };
  it('keeps a long salvo in one preallocated draw and tightens quality immediately', () => {
    const debris = new ImpactDebrisView(); const storage = debris.mesh.instanceMatrix.array;
    for (let i = 0; i < 1000; i++) debris.emit({ ...chip, seed: i });
    expect(debris.count).toBe(140);
    debris.limit(52); expect(debris.count).toBe(52); expect(debris.mesh.count).toBe(52);
    for (let i = 0; i < 100; i++) debris.emit(chip);
    debris.update(0.2);
    expect(debris.count).toBe(52); expect(debris.mesh.instanceMatrix.array).toBe(storage);
    expect([...storage].every(Number.isFinite)).toBe(true);
    debris.update(2); expect(debris.count).toBe(0); expect(debris.mesh.count).toBe(0); debris.dispose();
  });
  it('bounces masonry above the local floor and releases pool resources', () => {
    const debris = new ImpactDebrisView(4); debris.emit({ ...chip, y: 0.05, lift: -3 }); debris.update(0.05);
    const matrix = new Matrix4(); debris.mesh.getMatrixAt(0, matrix); const position = new Vector3().setFromMatrixPosition(matrix);
    expect(position.y).toBeGreaterThanOrEqual(0);
    const geometryDispose = vi.spyOn(debris.mesh.geometry, 'dispose'); const materialDispose = vi.spyOn(debris.mesh.material as MeshBasicMaterial, 'dispose');
    debris.dispose(); expect(geometryDispose).toHaveBeenCalledOnce(); expect(materialDispose).toHaveBeenCalledOnce();
  });
});

describe('unit surface damage', () => {
  const layout = { halfX: 2.47, halfZ: 2.75, topY: 1.23, sideY: 0.91, aircraft: false };
  it('places a wound on the incoming face and a plunging wound on the roof', () => {
    const mark = new Object3D(); positionUnitScar(mark, layout, { localX: 30, localZ: 1, top: false, force: 0.5 });
    expect(mark.position.x).toBeGreaterThan(layout.halfX); expect(mark.rotation.y).toBeCloseTo(Math.PI / 2);
    positionUnitScar(mark, layout, { localX: -30, localZ: 1, top: false, force: 0.5 }); expect(mark.position.x).toBeLessThan(-layout.halfX);
    positionUnitScar(mark, layout, { localX: 1, localZ: 1, top: true, force: 0.5 }); expect(mark.position.y).toBeGreaterThan(layout.topY); expect(mark.rotation.x).toBeCloseTo(-Math.PI / 2);
  });
  it('shows minor actual hits, bounds scars to one draw, and clears them after repair', () => {
    const material = new MeshBasicMaterial(), heat = new MeshBasicMaterial(); const scars = new UnitImpactScars(layout, material, heat);
    scars.stamp({ localX: 30, localZ: 0, top: false, force: 0.15 }, 0);
    scars.update(0, 0.05, 0.85); expect(scars.root.visible).toBe(true); expect(scars.marks.count).toBe(1);
    for (let i = 0; i < 100; i++) scars.stamp({ localX: i % 2 ? 1 : -1, localZ: 0, top: false, force: 0.5 }, 0.1);
    scars.update(2, 1, 0.4); expect(scars.marks.count).toBe(3); expect(scars.root.getObjectByName('unit-impact-heat')?.visible).toBe(false);
    scars.update(0, 2, 1); expect(scars.marks.count).toBe(0); expect(scars.root.visible).toBe(false);
    scars.stamp({ localX: 30, localZ: 0, top: false, force: 0.2 }, 2.1);
    scars.update(0, 2.2, 0.9);
    const afterRepair = new Matrix4(); scars.marks.getMatrixAt(0, afterRepair);
    expect(new Vector3().setFromMatrixPosition(afterRepair).x).toBeGreaterThan(0);
    scars.dispose(); material.dispose(); heat.dispose();
  });
});
