import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Matrix4, Box3, Group, Raycaster, Vector3 } from 'three';
import { createIntactHull, canBatchIntactHull } from './buildingHullBatch';

describe('intact building body batching', () => {
  it('preserves 64 cell transforms, bounds and ray hits in a single mesh', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial();
    const cells = Array.from({ length: 64 }, (_, i) => {
      const cell = new Mesh(geometry, material);
      cell.position.set(i % 8 * 2, Math.floor(i / 8) * 2, 0);
      cell.scale.set(1.8, 1.8, 2);
      return cell;
    });
    const hull = createIntactHull(cells);
    const originals = new Group();
    originals.add(...cells);
    originals.updateMatrixWorld(true);
    hull.updateMatrixWorld(true);
    const matrix = new Matrix4();
    cells.forEach((cell, i) => { hull.getMatrixAt(i, matrix); matrix.elements.forEach((value, j) => expect(value).toBeCloseTo(cell.matrix.elements[j], 6)); });
    const before = new Box3().setFromObject(originals);
    const after = new Box3().setFromObject(hull);
    after.min.toArray().forEach((value, i) => expect(value).toBeCloseTo(before.min.toArray()[i], 6));
    after.max.toArray().forEach((value, i) => expect(value).toBeCloseTo(before.max.toArray()[i], 6));
    const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    expect(ray.intersectObject(hull)[0].distance).toBeCloseTo(ray.intersectObject(originals)[0].distance);
    expect(hull.count).toBe(64);
    expect(hull.geometry).toBe(geometry);
    hull.dispose(); geometry.dispose(); material.dispose();
  });

  it('leaves damaged and collapsing buildings on the destructible representation', () => {
    expect(canBatchIntactHull(0, 0, false)).toBe(true);
    expect(canBatchIntactHull(1, 0, false)).toBe(false);
    expect(canBatchIntactHull(1, 4, false)).toBe(false);
    expect(canBatchIntactHull(0, 0, true)).toBe(false);
  });
});
