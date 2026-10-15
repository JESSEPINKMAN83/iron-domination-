import { InstancedMesh, type Mesh } from 'three';

/** Preserve the cell geometry and materials, but submit an intact hull once. */
export function createIntactHull(cells: readonly Mesh[]): InstancedMesh {
  if (!cells.length) throw new Error('An intact hull needs at least one cell');
  const hull = new InstancedMesh(cells[0].geometry, cells[0].material, cells.length);
  hull.name = 'intact-building-hull';
  hull.receiveShadow = true;
  for (let i = 0; i < cells.length; i++) {
    cells[i].updateMatrix();
    hull.setMatrixAt(i, cells[i].matrix);
  }
  hull.computeBoundingSphere();
  return hull;
}

export function canBatchIntactHull(version: number, damageLevel: number, destroyed: boolean): boolean {
  return !destroyed && version === 0 && damageLevel === 0;
}
