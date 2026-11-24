import { DynamicDrawUsage, Group, InstancedMesh, type BufferGeometry, type Material, type Mesh } from 'three';

/** Keep every damaged cell transform/shape, batch only compatible geometry and material. */
export class DamagedHullBatch {
  readonly root = new Group();
  private readonly batches = new Map<string, InstancedMesh>();
  constructor(private readonly capacity: number) { this.root.name = 'damaged-building-hull'; }
  sync(cells: readonly Mesh[]): void {
    for (const batch of this.batches.values()) batch.count = 0;
    for (const cell of cells) {
      if (!cell.visible) continue;
      const material = cell.material as Material;
      const key = `${cell.geometry.uuid}:${material.uuid}`;
      let batch = this.batches.get(key);
      if (!batch) {
        batch = new InstancedMesh(cell.geometry as BufferGeometry, material, this.capacity);
        batch.instanceMatrix.setUsage(DynamicDrawUsage);
        batch.count = 0;
        batch.receiveShadow = true;
        batch.name = 'damaged-hull-cells';
        this.batches.set(key, batch);
      }
      cell.updateMatrix();
      batch.setMatrixAt(batch.count++, cell.matrix);
    }
    for (const batch of this.batches.values()) {
      if (!batch.count) { batch.removeFromParent(); continue; }
      if (!batch.parent) this.root.add(batch);
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
    }
  }
  dispose(): void {
    for (const batch of this.batches.values()) { batch.removeFromParent(); batch.dispose(); }
    this.batches.clear(); // Geometry and palette materials belong to BuildingView.
  }
}
