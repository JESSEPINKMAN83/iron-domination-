import { BufferGeometry, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, Raycaster, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Entity } from '../sim/components';

export function canBatchWall(entity: Entity): boolean {
  return entity.building?.kind === 'wall' && !entity.destroyed &&
    !!entity.health && entity.health.current >= entity.health.max &&
    (!entity.structureDamage || entity.structureDamage.version === 0 || entity.structureDamage.cells.every((value) => value === 0));
}

/** One shared model/material set per faction, regardless of fence length. */
export class WallBatch {
  readonly root = new Group();
  readonly entities: Entity[] = [];
  private readonly parts: { geometry: BufferGeometry; material: Material; shadow: boolean; order: number; mesh: InstancedMesh }[] = [];
  private capacity = 32;

  constructor(template: Object3D) {
    template.updateMatrixWorld(true);
    const groups = new Map<Material, { geometry: BufferGeometry[]; shadow: boolean; order: number }>();
    const instance = new Matrix4();
    const transform = new Matrix4();
    template.traverseVisible((part) => {
      if (!(part instanceof Mesh) || Array.isArray(part.material)) return;
      let group = groups.get(part.material);
      if (!group) { group = { geometry: [], shadow: part.castShadow, order: part.renderOrder }; groups.set(part.material, group); }
      group.shadow ||= part.castShadow;
      group.order = Math.max(group.order, part.renderOrder);
      const count = part instanceof InstancedMesh ? part.count : 1;
      for (let i = 0; i < count; i++) {
        if (part instanceof InstancedMesh) { part.getMatrixAt(i, instance); transform.multiplyMatrices(part.matrixWorld, instance); }
        else transform.copy(part.matrixWorld);
        group.geometry.push(part.geometry.clone().applyMatrix4(transform));
      }
    });
    for (const [material, group] of groups) {
      const geometry = mergeGeometries(group.geometry, false);
      group.geometry.forEach((part) => part.dispose());
      if (!geometry) throw new Error('Wall model geometry could not be batched');
      const mesh = this.createMesh(geometry, material, group.shadow, group.order);
      this.parts.push({ geometry, material, shadow: group.shadow, order: group.order, mesh });
      this.root.add(mesh);
    }
  }

  private createMesh(geometry: BufferGeometry, material: Material, shadow: boolean, order: number): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, this.capacity);
    mesh.name = 'shared-fence';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = shadow;
    mesh.renderOrder = order;
    mesh.receiveShadow = true;
    mesh.count = 0;
    // BuildingView culls individual walls before adding them to the batch.
    mesh.frustumCulled = false;
    return mesh;
  }

  beginFrame(): void { this.entities.length = 0; }

  add(entity: Entity, matrix: Matrix4): void {
    const index = this.entities.length;
    if (index >= this.capacity) {
      this.capacity *= 2;
      const prior = new Matrix4();
      for (const part of this.parts) {
        const old = part.mesh;
        part.mesh = this.createMesh(part.geometry, part.material, part.shadow, part.order);
        for (let i = 0; i < index; i++) { old.getMatrixAt(i, prior); part.mesh.setMatrixAt(i, prior); }
        this.root.remove(old);
        old.dispose(); // release instance buffers, retain shared model geometry
        this.root.add(part.mesh);
      }
    }
    this.entities.push(entity);
    for (const part of this.parts) part.mesh.setMatrixAt(index, matrix);
  }

  endFrame(): void {
    for (const part of this.parts) {
      part.mesh.count = this.entities.length;
      part.mesh.visible = part.mesh.count > 0;
      part.mesh.instanceMatrix.needsUpdate = true;
      part.mesh.computeBoundingSphere();
    }
  }

  pick(ray: Raycaster): { entity: Entity; distance: number } | undefined {
    this.root.updateMatrixWorld(true);
    const hit = ray.intersectObjects(this.parts.filter((part) => part.mesh.visible && part.material.colorWrite).map((part) => part.mesh), false)[0];
    const entity = hit?.instanceId !== undefined ? this.entities[hit.instanceId] : undefined;
    return entity ? { entity, distance: hit.distance } : undefined;
  }

  dispose(): void {
    for (const part of this.parts) { part.mesh.dispose(); part.geometry.dispose(); }
    this.root.clear();
  }
}
