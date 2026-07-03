// Registry of named InstancedMeshes. Later phases register GLB-based unit and
// building meshes here; Phase 1 uses it for terrain props.
import { BufferGeometry, Color, InstancedMesh, Material, Matrix4, Quaternion, Vector3 } from 'three';

export interface InstanceTransform {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  tint?: Color;
}

export class InstancedMeshRegistry {
  private readonly meshes = new Map<string, InstancedMesh>();

  register(
    name: string,
    geometry: BufferGeometry,
    material: Material,
    instances: InstanceTransform[],
    shadows = true,
  ): InstancedMesh {
    if (this.meshes.has(name)) throw new Error(`instanced mesh '${name}' already registered`);
    const mesh = new InstancedMesh(geometry, material, instances.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const up = new Vector3(0, 1, 0);
    instances.forEach((inst, i) => {
      q.setFromAxisAngle(up, inst.rotY);
      p.set(inst.x, inst.y, inst.z);
      s.setScalar(inst.scale);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (inst.tint) mesh.setColorAt(i, inst.tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    this.meshes.set(name, mesh);
    return mesh;
  }

  get(name: string): InstancedMesh | undefined {
    return this.meshes.get(name);
  }

  get totalInstances(): number {
    let n = 0;
    for (const mesh of this.meshes.values()) n += mesh.count;
    return n;
  }
}
