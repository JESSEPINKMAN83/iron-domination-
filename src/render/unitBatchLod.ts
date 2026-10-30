// Distant-unit detail batching. A detailed unit is a hierarchy of ~50-95 meshes
// and three.js walks every node each frame (matrices, culling, draw setup) for
// the main pass, shadows and post-processing. Beyond close inspection range the
// same model is drawn from one merged geometry per material through instancing,
// so a distant army costs a few draw calls instead of thousands of scene nodes.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const INITIAL_CAPACITY = 32;

type SyncedMaterial = Material & {
  color?: { copy(source: unknown): unknown };
  emissive?: { copy(source: unknown): unknown };
  emissiveIntensity?: number;
};

interface InstancedMaterial {
  material: Material;
  sourceVersion: number;
}

interface BatchPart {
  material: Material;
  geometry: BufferGeometry;
  mesh: InstancedMesh;
  count: number;
}

interface UnitBatch {
  hull: BatchPart[];
  turret: BatchPart[];
  /** Turret pivot parent transform relative to the unit root at rest. */
  turretParentRest?: Matrix4;
}

/** True when the object and every ancestor up to (and including) root are visible. */
function visibleWithin(obj: Object3D, root: Object3D, excluded: ReadonlySet<Object3D>): boolean {
  for (let cur: Object3D | null = obj; cur; cur = cur.parent) {
    if (!cur.visible || excluded.has(cur)) return false;
    if (cur === root) return true;
  }
  return false;
}

function isDescendantOf(obj: Object3D, ancestor: Object3D | undefined): boolean {
  if (!ancestor) return false;
  for (let cur: Object3D | null = obj; cur; cur = cur.parent) if (cur === ancestor) return true;
  return false;
}

function bakeableMaterial(material: Material | Material[]): material is Material {
  if (Array.isArray(material)) return false;
  // Muzzle flashes, glows and smoke are transient effects, not the model body.
  return !material.transparent && material.blending !== AdditiveBlending && material.visible;
}

function normalizedGeometry(source: BufferGeometry, matrix: Matrix4, material: Material): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') geometry.deleteAttribute(name);
  }
  const vertices = geometry.attributes.position.count;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.attributes.uv) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(vertices * 2), 2));
  const wantsColor = (material as Material & { vertexColors?: boolean }).vertexColors === true;
  if (!wantsColor && geometry.attributes.color) geometry.deleteAttribute('color');
  if (wantsColor && !geometry.attributes.color) {
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(vertices * 3).fill(1), 3));
  }
  if (wantsColor && geometry.attributes.color.itemSize !== 3) geometry.deleteAttribute('color');
  geometry.clearGroups();
  geometry.morphAttributes = {};
  geometry.applyMatrix4(matrix);
  return geometry;
}

function createPartMesh(geometry: BufferGeometry, material: Material, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  // Instances span the battlefield; the per-unit camera culling already ran.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function copyShaderHooks(source: Material, target: Material): void {
  // Material.copy() leaves these out; terrain-aware and team shaders rely on them.
  target.onBeforeCompile = source.onBeforeCompile;
  target.customProgramCacheKey = source.customProgramCacheKey;
}

export class UnitBatchLod {
  readonly group = new Group();
  private readonly batches = new Map<string, UnitBatch | null>();
  private readonly scratch = new Matrix4();
  // Instanced parts draw with their own copy of each unit material. Sharing one
  // material between plain and instanced meshes makes three.js re-resolve the
  // shader program on every draw that switches between them.
  private readonly instancedMaterials = new Map<Material, InstancedMaterial>();

  has(key: string): boolean {
    return Boolean(this.batches.get(key));
  }

  /** Bake a freshly built unit (root at identity) once per visual key. */
  bake(key: string, root: Object3D, turretPivot?: Object3D, excluded: readonly Object3D[] = []): void {
    if (this.batches.has(key)) return;
    root.updateMatrixWorld(true);
    const excludedSet = new Set(excluded);
    const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
    const pivotInverse = turretPivot ? new Matrix4().copy(turretPivot.matrixWorld).invert() : undefined;
    const hull = new Map<Material, BufferGeometry[]>();
    const turret = new Map<Material, BufferGeometry[]>();
    root.traverse((obj) => {
      if (!(obj instanceof Mesh) || (obj as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) return;
      if (!bakeableMaterial(obj.material) || !visibleWithin(obj, root, excludedSet)) return;
      const inTurret = pivotInverse !== undefined && isDescendantOf(obj, turretPivot);
      const local = new Matrix4().multiplyMatrices(inTurret ? pivotInverse : rootInverse, obj.matrixWorld);
      const target = inTurret ? turret : hull;
      const list = target.get(obj.material) ?? [];
      list.push(normalizedGeometry(obj.geometry, local, obj.material));
      target.set(obj.material, list);
    });
    const build = (parts: Map<Material, BufferGeometry[]>): BatchPart[] | undefined => {
      const result: BatchPart[] = [];
      for (const [material, geometries] of parts) {
        const merged = mergeGeometries(geometries, false);
        for (const geometry of geometries) geometry.dispose();
        if (!merged) return undefined;
        const instancedMaterial = this.instancedMaterial(material);
        const mesh = createPartMesh(merged, instancedMaterial, INITIAL_CAPACITY);
        this.group.add(mesh);
        result.push({ material: instancedMaterial, geometry: merged, mesh, count: 0 });
      }
      return result;
    };
    const hullParts = build(hull);
    const turretParts = build(turret);
    if (!hullParts || !turretParts || hullParts.length === 0) {
      // Unmergeable model: keep using the detailed hierarchy for this kind.
      for (const part of [...(hullParts ?? []), ...(turretParts ?? [])]) this.disposePart(part);
      this.batches.set(key, null);
      return;
    }
    this.batches.set(key, {
      hull: hullParts,
      turret: turretParts,
      turretParentRest: turretPivot?.parent
        ? new Matrix4().multiplyMatrices(rootInverse, turretPivot.parent.matrixWorld)
        : undefined,
    });
  }

  begin(): void {
    this.syncInstancedMaterials();
    for (const batch of this.batches.values()) {
      if (!batch) continue;
      for (const part of batch.hull) part.count = 0;
      for (const part of batch.turret) part.count = 0;
    }
  }

  /** Queue one unit. `rootMatrix` is the posed unit root; `turretLocal` the posed pivot's local matrix. */
  add(key: string, rootMatrix: Matrix4, turretLocal?: Matrix4): boolean {
    const batch = this.batches.get(key);
    if (!batch) return false;
    for (const part of batch.hull) this.push(part, rootMatrix);
    if (batch.turret.length > 0) {
      this.scratch.copy(rootMatrix);
      if (batch.turretParentRest) this.scratch.multiply(batch.turretParentRest);
      if (turretLocal) this.scratch.multiply(turretLocal);
      for (const part of batch.turret) this.push(part, this.scratch);
    }
    return true;
  }

  end(): void {
    for (const batch of this.batches.values()) {
      if (!batch) continue;
      for (const part of batch.hull) this.finishPart(part);
      for (const part of batch.turret) this.finishPart(part);
    }
  }

  private finishPart(part: BatchPart): void {
    part.mesh.count = part.count;
    if (part.count > 0) part.mesh.instanceMatrix.needsUpdate = true;
    part.mesh.visible = part.count > 0;
  }

  private instancedMaterial(source: Material): Material {
    const cached = this.instancedMaterials.get(source);
    if (cached) return cached.material;
    const material = source.clone();
    copyShaderHooks(source, material);
    this.instancedMaterials.set(source, { material, sourceVersion: source.version });
    return material;
  }

  /** Mirror runtime tweaks (accent glow, damage tint, recompiles) onto the instanced copies. */
  private syncInstancedMaterials(): void {
    for (const [source, entry] of this.instancedMaterials) {
      const target = entry.material as SyncedMaterial;
      if (source.version !== entry.sourceVersion) {
        target.copy(source);
        copyShaderHooks(source, target);
        target.needsUpdate = true;
        entry.sourceVersion = source.version;
        continue;
      }
      const from = source as SyncedMaterial;
      if (from.color && target.color) target.color.copy(from.color);
      if (from.emissive && target.emissive) target.emissive.copy(from.emissive);
      if (from.emissiveIntensity !== undefined) target.emissiveIntensity = from.emissiveIntensity;
      target.opacity = source.opacity;
      target.visible = source.visible;
    }
  }

  private push(part: BatchPart, matrix: Matrix4): void {
    if (part.count >= part.mesh.instanceMatrix.count) this.grow(part);
    part.mesh.setMatrixAt(part.count++, matrix);
  }

  private grow(part: BatchPart): void {
    const old = part.mesh;
    const next = createPartMesh(part.geometry, part.material, old.instanceMatrix.count * 2);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    this.group.remove(old);
    old.dispose();
    this.group.add(next);
    part.mesh = next;
  }

  private disposePart(part: BatchPart): void {
    this.group.remove(part.mesh);
    part.mesh.dispose();
    part.geometry.dispose();
  }
}
