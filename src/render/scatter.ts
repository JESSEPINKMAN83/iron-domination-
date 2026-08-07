// Scatters 5,000 instanced low-poly trees and rocks on valid terrain
// (dry, not too steep, outside ore fields). Placement is seed-deterministic.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../sim/noise';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import type { InstancedMeshRegistry, InstanceTransform } from './instancing';
import type { MacroTintMap } from './textures';

const MAX_GROUND_TUFTS = 6000;
const BUILDING_CONTACT_RESERVE = 512;

interface ScatterOptions {
  macroTint?: MacroTintMap;
  groundRealism?: boolean;
  enableGroundClutter?: boolean;
}

interface ContactEntity {
  destroyed?: unknown;
  building?: unknown;
  transform: { x: number; z: number };
  collider?: { radius: number };
}

interface ContactTransform { x: number; y: number; z: number; radius: number }

function paint(geom: BufferGeometry, color: Color): BufferGeometry {
  const out = geom.index ? geom.toNonIndexed() : geom;
  const count = out.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  out.setAttribute('color', new BufferAttribute(colors, 3));
  return out;
}

function pineGeometry(style: Heightfield['kind'] = 'highlands'): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.16, 0.24, 1.6, 6).translate(0, 0.8, 0), new Color('#6b4a2f'));
  const c1Color = style === 'frostbite-pass' ? '#7f9490' : style === 'crater-oasis' ? '#50683c' : '#2f5c33';
  const c2Color = style === 'frostbite-pass' ? '#b7c9c5' : style === 'crater-oasis' ? '#617747' : '#356839';
  const c3Color = style === 'frostbite-pass' ? '#d8e6e3' : style === 'crater-oasis' ? '#748457' : '#3c7440';
  const c1 = paint(new ConeGeometry(1.5, 2.4, 7).translate(0, 2.4, 0), new Color(c1Color));
  const c2 = paint(new ConeGeometry(1.1, 2.0, 7).translate(0, 3.8, 0), new Color(c2Color));
  const c3 = paint(new ConeGeometry(0.7, 1.6, 7).translate(0, 5.0, 0), new Color(c3Color));
  return mergeGeometries([trunk, c1, c2, c3]);
}

function broadleafGeometry(rng: () => number, style: Heightfield['kind'] = 'highlands'): BufferGeometry {
  const trunkColor = style === 'crater-oasis' ? '#7a5d35' : style === 'frostbite-pass' ? '#6e5c55' : '#71513a';
  const canopyColor = style === 'crater-oasis' ? '#8a8147' : style === 'frostbite-pass' ? '#c5d4cf' : '#3f7a37';
  const trunk = paint(new CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0), new Color(trunkColor));
  const canopy = new IcosahedronGeometry(1.7, 1);
  const pos = canopy.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 0.85 + rng() * 0.3;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  canopy.scale(1, 0.85, 1);
  canopy.translate(0, 3.0, 0);
  paint(canopy, new Color(canopyColor));
  return mergeGeometries([trunk, canopy]);
}

function rockGeometry(rng: () => number, flatten: number, style: Heightfield['kind'] = 'highlands'): BufferGeometry {
  const rock = new IcosahedronGeometry(1, 1);
  const pos = rock.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 0.75 + rng() * 0.55;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * flatten, pos.getZ(i) * k);
  }
  rock.computeVertexNormals();
  const color = style === 'crater-oasis' ? '#9c805b' : style === 'frostbite-pass' ? '#b6c0c6' : '#8a8d90';
  return paint(rock, new Color(color));
}

interface ScatterDef {
  name: string;
  geometry: BufferGeometry;
  count: number;
  scaleMin: number;
  scaleMax: number;
  maxSlope: number;
  isTree: boolean;
}

interface CrushableTree {
  mesh: InstancedMesh;
  index: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  crushed: boolean;
}

export class ScatterView {
  readonly group = new Group();
  private readonly trees: CrushableTree[] = [];
  private readonly treeGrid = new Map<string, CrushableTree[]>();
  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly crushedColor = new Color('#3b3026');
  private readonly gridSize = 9;
  private grassMesh?: InstancedMesh;
  private grassMaterial?: Material;
  private grassFullCount = 0;
  private contactMesh?: InstancedMesh;
  private contactStaticCount = 0;
  private contactCapacity = 0;

  setGroundClutter(mesh: InstancedMesh, material: Material): void {
    this.grassMesh = mesh;
    this.grassMaterial = material;
    this.grassFullCount = mesh.count;
  }

  setContactLayer(mesh: InstancedMesh, staticCount: number, capacity: number): void {
    this.contactMesh = mesh;
    this.contactStaticCount = staticCount;
    this.contactCapacity = capacity;
    this.group.add(mesh);
  }

  updateGroundEffects(timeSeconds: number, qualityTier: number): void {
    const uniforms = this.grassMaterial?.userData.groundUniforms as { time: { value: number } } | undefined;
    if (uniforms) uniforms.time.value = timeSeconds;
    if (this.grassMesh) {
      this.grassMesh.visible = qualityTier < 2;
      this.grassMesh.count = qualityTier === 1 ? Math.ceil(this.grassFullCount * 0.55) : this.grassFullCount;
    }
    if (this.contactMesh) this.contactMesh.visible = qualityTier < 2;
  }

  syncBuildingContacts(entities: Iterable<ContactEntity>, hf: Heightfield): void {
    const mesh = this.contactMesh;
    if (!mesh) return;
    let index = this.contactStaticCount;
    this.quat.identity();
    for (const entity of entities) {
      if (!entity.building || entity.destroyed || index >= this.contactCapacity) continue;
      const radius = Math.min(5.5, Math.max(1.4, (entity.collider?.radius ?? 2.4) * 0.5));
      this.pos.set(entity.transform.x, sampleHeight(hf, entity.transform.x, entity.transform.z) + 0.08, entity.transform.z);
      this.scale.set(radius, radius, radius);
      this.matrix.compose(this.pos, this.quat, this.scale);
      mesh.setMatrixAt(index++, this.matrix);
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
  }

  addMesh(mesh: InstancedMesh): void {
    this.group.add(mesh);
  }

  addTree(tree: CrushableTree): void {
    this.trees.push(tree);
    const key = this.gridKey(tree.x, tree.z);
    const bucket = this.treeGrid.get(key);
    if (bucket) bucket.push(tree);
    else this.treeGrid.set(key, [tree]);
  }

  crushNear(x: number, z: number, radius: number): number {
    let crushed = 0;
    const minX = Math.floor((x - radius) / this.gridSize);
    const maxX = Math.floor((x + radius) / this.gridSize);
    const minZ = Math.floor((z - radius) / this.gridSize);
    const maxZ = Math.floor((z + radius) / this.gridSize);
    const r2 = radius * radius;
    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const bucket = this.treeGrid.get(`${gx}:${gz}`);
        if (!bucket) continue;
        for (const tree of bucket) {
          if (tree.crushed) continue;
          const d2 = (tree.x - x) ** 2 + (tree.z - z) ** 2;
          if (d2 > r2) continue;
          tree.crushed = true;
          crushed++;
          this.applyCrushedTree(tree);
        }
      }
    }
    return crushed;
  }

  private applyCrushedTree(tree: CrushableTree): void {
    const fallSide = tree.index % 2 === 0 ? 1 : -1;
    this.quat.setFromEuler(new Euler(Math.PI * 0.47 * fallSide, tree.rotY, Math.PI * 0.08 * fallSide, 'YXZ'));
    this.pos.set(tree.x, tree.y + 0.12, tree.z);
    this.scale.set(tree.scale * 1.04, tree.scale * 0.72, tree.scale * 1.04);
    this.matrix.compose(this.pos, this.quat, this.scale);
    tree.mesh.setMatrixAt(tree.index, this.matrix);
    tree.mesh.setColorAt(tree.index, this.crushedColor);
    tree.mesh.instanceMatrix.needsUpdate = true;
    if (tree.mesh.instanceColor) tree.mesh.instanceColor.needsUpdate = true;
  }

  private gridKey(x: number, z: number): string {
    return `${Math.floor(x / this.gridSize)}:${Math.floor(z / this.gridSize)}`;
  }
}

export function buildScatter(
  hf: Heightfield,
  registry: InstancedMeshRegistry,
  material: Material,
  seed: number,
  options: ScatterOptions = {},
): ScatterView {
  const rng = mulberry32(seed);
  const kind = hf.kind;
  const treeFactor = kind === 'crater-oasis' ? 0.2 : kind === 'frostbite-pass' ? 0.48 : 1;
  const rockFactor = kind === 'crater-oasis' ? 1.45 : kind === 'frostbite-pass' ? 1.25 : 1;
  const defs: ScatterDef[] = [
    { name: 'pine', geometry: pineGeometry(kind), count: Math.round(2200 * treeFactor), scaleMin: 0.7, scaleMax: 1.5, maxSlope: 0.5, isTree: true },
    { name: 'broadleaf', geometry: broadleafGeometry(rng, kind), count: Math.round(1300 * treeFactor), scaleMin: 0.7, scaleMax: 1.4, maxSlope: 0.5, isTree: true },
    { name: 'rock-a', geometry: rockGeometry(rng, 0.72, kind), count: Math.round(800 * rockFactor), scaleMin: 0.5, scaleMax: 1.9, maxSlope: 0.9, isTree: false },
    { name: 'rock-b', geometry: rockGeometry(rng, 0.45, kind), count: Math.round(700 * rockFactor), scaleMin: 0.4, scaleMax: 1.5, maxSlope: 0.9, isTree: false },
  ];

  const view = new ScatterView();
  const contactTransforms: ContactTransform[] = [];
  const bound = hf.size / 2 - 12;
  for (const def of defs) {
    const list: InstanceTransform[] = [];
    let guard = 0;
    while (list.length < def.count && guard++ < def.count * 80) {
      const x = (rng() * 2 - 1) * bound;
      const z = (rng() * 2 - 1) * bound;
      const h = sampleHeight(hf, x, z);
      if (h < hf.waterLevel + 0.9) continue;
      const gx = Math.abs(sampleHeight(hf, x + 1.4, z) - sampleHeight(hf, x - 1.4, z)) / 2.8;
      const gz = Math.abs(sampleHeight(hf, x, z + 1.4) - sampleHeight(hf, x, z - 1.4)) / 2.8;
      if (Math.max(gx, gz) > def.maxSlope) continue;
      if (hf.oreFields.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < (f.radius + 6) ** 2)) continue;

      const v = 0.78 + rng() * 0.4;
      const tint =
        def.isTree && kind === 'frostbite-pass'
          ? new Color(v * 0.92, v, v * 1.06)
          : def.isTree && kind === 'crater-oasis'
            ? new Color(v * 1.08, v * 0.94, v * 0.72)
            : def.isTree
              ? new Color(v * (0.92 + rng() * 0.12), v, v * (0.9 + rng() * 0.1))
              : new Color(v, v, v);
      list.push({
        x,
        y: h - 0.15,
        z,
        rotY: rng() * Math.PI * 2,
        scale: def.scaleMin + rng() * (def.scaleMax - def.scaleMin),
        tint,
      });
      contactTransforms.push({ x, y: h + 0.07, z, radius: def.isTree ? 0.62 : 0.48 });
    }
    const mesh = registry.register(def.name, def.geometry, material, list);
    view.addMesh(mesh);
    if (def.isTree) {
      list.forEach((inst, index) => {
        view.addTree({
          mesh,
          index,
          x: inst.x,
          y: inst.y,
          z: inst.z,
          rotY: inst.rotY,
          scale: inst.scale,
          crushed: false,
        });
      });
    }
  }
  const groundRealism = options.groundRealism !== false;
  if (groundRealism && options.enableGroundClutter !== false) {
    // Keep this tiny alpha-cutout layer out of CSM: cascaded shadow patching
    // makes sub-pixel blades turn into dark specks at strategy-view distance.
    const grassMaterial = createGrassTuftMaterial(kind);
    const tufts = createGroundTufts(hf, seed ^ 0x47524153, options.macroTint);
    const grassMesh = registry.register('ground-tufts', createGrassTuftGeometry(), grassMaterial, tufts);
    grassMesh.castShadow = false;
    grassMesh.receiveShadow = false;
    grassMesh.frustumCulled = false;
    view.addMesh(grassMesh);
    view.setGroundClutter(grassMesh, grassMaterial);
  }
  if (groundRealism) {
    const contactCapacity = contactTransforms.length + BUILDING_CONTACT_RESERVE;
    const contactMesh = createContactLayer(contactCapacity, contactTransforms);
    view.setContactLayer(contactMesh, contactTransforms.length, contactCapacity);
  }
  return view;
}

export function groundClutterTargetCount(hf: Heightfield): number {
  return Math.min(MAX_GROUND_TUFTS, Math.floor((hf.size * hf.size) / 25));
}

function createGroundTufts(hf: Heightfield, seed: number, macro?: MacroTintMap): InstanceTransform[] {
  const rng = mulberry32(seed);
  const target = groundClutterTargetCount(hf);
  const result: InstanceTransform[] = [];
  const bound = hf.size / 2 - 10;
  let guard = 0;
  while (result.length < target && guard++ < target * 35) {
    const x = (rng() * 2 - 1) * bound;
    const z = (rng() * 2 - 1) * bound;
    const h = sampleHeight(hf, x, z);
    if (h < hf.waterLevel + 0.65 || splatWeightAt(hf, x, z, 0) < 0.48) continue;
    const slope = Math.max(
      Math.abs(sampleHeight(hf, x + 0.9, z) - sampleHeight(hf, x - 0.9, z)),
      Math.abs(sampleHeight(hf, x, z + 0.9) - sampleHeight(hf, x, z - 0.9)),
    ) / 1.8;
    if (slope > 0.55) continue;
    const macroColor = sampleMacroTint(macro, x, z);
    const base = hf.kind === 'crater-oasis' ? new Color('#c0a465') : hf.kind === 'frostbite-pass' ? new Color('#d2dfdc') : new Color('#78975b');
    base.multiply(macroColor).multiplyScalar(0.86 + rng() * 0.24);
    result.push({ x, y: h + 0.02, z, rotY: rng() * Math.PI * 2, scale: 0.82 + rng() * 0.72, tint: base });
  }
  return result;
}

function splatWeightAt(hf: Heightfield, x: number, z: number, channel: number): number {
  const gx = Math.max(0, Math.min(hf.samples - 1, Math.round((x / hf.size + 0.5) * (hf.samples - 1))));
  const gz = Math.max(0, Math.min(hf.samples - 1, Math.round((z / hf.size + 0.5) * (hf.samples - 1))));
  return hf.splat[(gz * hf.samples + gx) * 4 + channel] / 255;
}

function sampleMacroTint(macro: MacroTintMap | undefined, x: number, z: number): Color {
  if (!macro) return new Color(1, 1, 1);
  const px = Math.max(0, Math.min(macro.size - 1, Math.round((x / macro.worldSize + 0.5) * (macro.size - 1))));
  const py = Math.max(0, Math.min(macro.size - 1, Math.round((z / macro.worldSize + 0.5) * (macro.size - 1))));
  const i = (py * macro.size + px) * 4;
  return new Color(
    0.68 + (macro.data[i] / 255) * 0.64,
    0.68 + (macro.data[i + 1] / 255) * 0.64,
    0.68 + (macro.data[i + 2] / 255) * 0.64,
  );
}

function createGrassTuftGeometry(): BufferGeometry {
  const positions: number[] = [];
  const clusters = [[0, 0], [0.34, 0.18], [-0.27, 0.28]] as const;
  for (let cluster = 0; cluster < clusters.length; cluster++) {
    const [cx, cz] = clusters[cluster];
    for (let blade = 0; blade < 7; blade++) {
      const angle = (blade / 7) * Math.PI + cluster * 0.47;
      const dx = Math.cos(angle) * 0.13;
      const dz = Math.sin(angle) * 0.13;
      const leanX = Math.cos(angle + 0.8) * (0.05 + (blade % 2) * 0.025);
      const leanZ = Math.sin(angle + 0.8) * (0.05 + (blade % 2) * 0.025);
      const height = 0.54 + ((blade + cluster) % 3) * 0.12;
      positions.push(cx - dx, 0, cz - dz, cx + dx, 0, cz + dz, cx + leanX, height, cz + leanZ);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createGrassTuftMaterial(_kind: Heightfield['kind']): MeshBasicMaterial {
  // The terrain and contact layer provide the lighting cue. Keeping tiny
  // blades unlit preserves their biome tint instead of turning side-facing
  // triangles into black specks at normal RTS camera angles.
  const material = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, toneMapped: true });
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.call(material, shader, renderer);
    shader.uniforms.uGroundTime = { value: 0 };
    material.userData.groundUniforms = { time: shader.uniforms.uGroundTime };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGroundTime;\nvarying float vGroundFade;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 tuftCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float tuftPhase = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
          transformed.x += sin(uGroundTime * 1.35 + tuftPhase) * position.y * 0.055;
          vGroundFade = 1.0 - smoothstep(72.0, 155.0, distance(cameraPosition, tuftCenter));
        #else
          vGroundFade = 1.0;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGroundFade;')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        float groundDither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        if (groundDither > vGroundFade) discard;`);
  };
  material.customProgramCacheKey = () => 'ground-tufts-v1';
  return material;
}

function createContactLayer(capacity: number, contacts: ContactTransform[]): InstancedMesh {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(0,0,0,0.72)');
  gradient.addColorStop(0.48, 'rgba(0,0,0,0.28)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const map = new CanvasTexture(canvas);
  const material = new MeshBasicMaterial({ map, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
  const geometry = new CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const mesh = new InstancedMesh(geometry, material, capacity);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const quaternion = new Quaternion();
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    position.set(contact.x, contact.y, contact.z);
    scale.set(contact.radius, contact.radius, contact.radius);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.count = contacts.length;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}
