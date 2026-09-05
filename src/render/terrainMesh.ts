// Builds the chunked terrain mesh with a splat-mapped standard material
// (CSM-shadow compatible) plus a walkability debug overlay (F3).
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  RGBAFormat,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { CSM } from 'three/addons/csm/CSM.js';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import {
  createDetailNormalTexture,
  createDirtTexture,
  createGrassTexture,
  createMacroTintMap,
  createOreTexture,
  createRockTexture,
  type MacroTintMap,
  type TerrainTextureStyle,
} from './textures';
import type { ResourceNode } from '../sim/world';
import { mulberry32 } from '../sim/noise';

const CHUNKS = 4;

interface OreGlow {
  rim: Mesh;
  rig: Group;
  pumpJack: Group;
  rimMaterial: MeshBasicMaterial;
  statusMaterial: MeshBasicMaterial;
  rigMaterials: MeshStandardMaterial[];
  deposits?: InstancedMesh;
  depositMaterial?: MeshStandardMaterial;
  crystals?: Mesh[];
  crystalMaterials?: MeshStandardMaterial[];
  lastPct: number;
}

function buildChunkGeometry(hf: Heightfield, startX: number, startY: number, chunkCells: number): BufferGeometry {
  const { heights, samples, cells, cellSize } = hf;
  const half = hf.size / 2;
  const w = chunkCells + 1;
  const positions = new Float32Array(w * w * 3);
  const normals = new Float32Array(w * w * 3);
  const uvs = new Float32Array(w * w * 2);

  for (let vy = 0; vy < w; vy++) {
    const gy = startY + vy;
    for (let vx = 0; vx < w; vx++) {
      const gx = startX + vx;
      const i = vy * w + vx;
      const h = heights[gy * samples + gx];
      positions[i * 3] = gx * cellSize - half;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = gy * cellSize - half;

      // analytic normal from the shared heightfield → seamless across chunks
      const hL = heights[gy * samples + Math.max(gx - 1, 0)];
      const hR = heights[gy * samples + Math.min(gx + 1, samples - 1)];
      const hD = heights[Math.max(gy - 1, 0) * samples + gx];
      const hU = heights[Math.min(gy + 1, samples - 1) * samples + gx];
      const nx = hL - hR;
      const ny = 2 * cellSize;
      const nz = hD - hU;
      const inv = 1 / Math.hypot(nx, ny, nz);
      normals[i * 3] = nx * inv;
      normals[i * 3 + 1] = ny * inv;
      normals[i * 3 + 2] = nz * inv;

      uvs[i * 2] = gx / cells;
      uvs[i * 2 + 1] = gy / cells;
    }
  }

  const indices = new Uint32Array(chunkCells * chunkCells * 6);
  let o = 0;
  for (let vy = 0; vy < chunkCells; vy++) {
    for (let vx = 0; vx < chunkCells; vx++) {
      const a = vy * w + vx;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('normal', new BufferAttribute(normals, 3));
  geom.setAttribute('uv', new BufferAttribute(uvs, 2));
  geom.setIndex(new BufferAttribute(indices, 1));
  return geom;
}

export class TerrainView {
  readonly group = new Group();
  readonly macroTint: MacroTintMap;
  /** shared with overlays that drape data over the terrain (walkability, fog) */
  readonly chunkGeometries: BufferGeometry[] = [];
  private readonly overlayGroup = new Group();
  private readonly oreGlowGroup = new Group();
  private readonly oreGlows: OreGlow[] = [];

  constructor(hf: Heightfield, csm: CSM | undefined, maxAnisotropy: number, seed: number, groundRealism = true) {
    this.macroTint = createMacroTintMap(hf, seed);
    const material = createSplatMaterial(hf, csm, maxAnisotropy, this.macroTint, groundRealism);
    const overlayMaterial = createWalkOverlayMaterial(hf);

    const chunkCells = hf.cells / CHUNKS;
    for (let cy = 0; cy < CHUNKS; cy++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const geom = buildChunkGeometry(hf, cx * chunkCells, cy * chunkCells, chunkCells);
        this.chunkGeometries.push(geom);
        const mesh = new Mesh(geom, material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);

        const overlay = new Mesh(geom, overlayMaterial);
        overlay.matrixAutoUpdate = false;
        overlay.renderOrder = 100;
        this.overlayGroup.add(overlay);
      }
    }
    const skirt = new Mesh(
      createTerrainSkirtGeometry(hf, Math.max(12, hf.size * 0.012)),
      new MeshStandardMaterial({
        color: terrainSkirtColor(hf),
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
    );
    skirt.name = 'terrain-edge-skirt';
    skirt.receiveShadow = true;
    skirt.castShadow = false;
    skirt.matrixAutoUpdate = false;
    this.group.add(skirt);
    this.overlayGroup.visible = false;
    this.overlayGroup.renderOrder = 100;
    this.oreGlowGroup.renderOrder = 22;
    this.buildOreGlow(hf);
    this.group.add(this.oreGlowGroup);
    this.group.add(this.overlayGroup);
  }

  toggleWalkOverlay(): boolean {
    this.overlayGroup.visible = !this.overlayGroup.visible;
    return this.overlayGroup.visible;
  }

  updateResources(nodes: ResourceNode[]): void {
    const now = performance.now() * 0.001;
    for (let i = 0; i < this.oreGlows.length; i++) {
      const node = nodes[i];
      const glow = this.oreGlows[i];
      const pct = node ? Math.max(0, Math.min(1, node.remaining / node.capacity)) : 0;
      const visible = pct > 0.01;
      glow.rig.visible = pct > 0.005;
      glow.rig.scale.setScalar(0.92 + pct * 0.08);
      glow.pumpJack.rotation.x = Math.sin(now * 2.4 + i * 0.7) * (0.05 + pct * 0.14);
      glow.statusMaterial.opacity = pct > 0.08 ? 0.35 + Math.sin(now * 5 + i) * 0.18 : 0.08;
      glow.statusMaterial.color.setHex(pct < 0.16 ? 0xff5a3d : pct < 0.42 ? 0xffc25a : 0x7df27d);
      for (const material of glow.rigMaterials) {
        material.opacity = 0.35 + pct * 0.65;
        material.color.lerpColors(material.userData.depletedColor, material.userData.fullColor, pct);
      }
      if (glow.deposits && glow.depositMaterial) {
        if (glow.lastPct === pct) continue;
        glow.lastPct = pct;
        glow.rim.visible = visible;
        glow.rimMaterial.opacity = 0.035 + pct * 0.1;
        glow.deposits.visible = visible;
        glow.depositMaterial.emissiveIntensity = 0.05 + pct * 0.24;
        continue;
      }
      glow.rim.visible = visible;
      glow.rimMaterial.opacity = 0.02 + pct * 0.09;
      const crystals = glow.crystals;
      const crystalMaterials = glow.crystalMaterials;
      if (!crystals || !crystalMaterials) continue;
      for (let c = 0; c < crystals.length; c++) {
        const crystal = crystals[c];
        const material = crystalMaterials[c];
        const seed = crystal.userData.seed as number;
        const baseScale = crystal.userData.baseScale as number;
        crystal.visible = visible;
        crystal.scale.setScalar(baseScale * (0.55 + pct * 0.45));
        crystal.rotation.y = crystal.userData.baseRotY + Math.sin(now * 0.6 + seed) * 0.06;
        material.opacity = 0.55 + pct * 0.4;
        material.emissiveIntensity = 0.9 + pct * 1.4 + Math.sin(now * 1.7 + seed) * 0.25;
      }
    }
  }

  private buildOreGlow(hf: Heightfield): void {
    if (hf.kind === 'highlands') {
      this.buildHighlandsOreDeposits(hf);
      return;
    }
    for (const field of hf.oreFields) {
      const rimMaterial = oreGlowMaterial(0xd9b25a, 0.1);
      const rim = new Mesh(createTerrainDiscGeometry(hf, field.x, field.z, field.radius * 1.05, 72, 0.14), rimMaterial);
      rim.renderOrder = 22;
      rim.visible = false;
      this.oreGlowGroup.add(rim);

      const rig = createOilFieldRig(field.radius);
      rig.position.set(field.x, sampleHeight(hf, field.x, field.z) + 0.54, field.z);
      rig.rotation.y = hashAngle(field.x, field.z);
      this.oreGlowGroup.add(rig);

      const crystals: Mesh[] = [];
      const crystalMaterials: MeshStandardMaterial[] = [];
      const rng = mulberry32((Math.floor(field.x * 31) ^ Math.floor(field.z * 57) ^ 0x9e3779b9) >>> 0);
      const crystalCount = Math.max(12, Math.round(field.radius * 0.95));
      for (let c = 0; c < crystalCount; c++) {
        const angle = rng() * Math.PI * 2;
        const distance = field.radius * (0.18 + rng() * 0.6);
        const x = field.x + Math.cos(angle) * distance;
        const z = field.z + Math.sin(angle) * distance;
        const size = 0.55 + rng() * 1.0;
        const material = new MeshStandardMaterial({
          color: 0x3a2f1d,
          emissive: 0xe0a83e,
          emissiveIntensity: 1.8,
          roughness: 0.3,
          metalness: 0.1,
          transparent: true,
          opacity: 0.95,
        });
        const crystal = new Mesh(new TetrahedronGeometry(1, 0), material);
        crystal.position.set(x, sampleHeight(hf, x, z) + size * 0.42, z);
        crystal.rotation.set(rng() * 0.9 - 0.45, rng() * Math.PI * 2, rng() * 0.9 - 0.45);
        crystal.castShadow = true;
        crystal.userData.seed = rng() * Math.PI * 2;
        crystal.userData.baseScale = size;
        crystal.userData.baseRotY = crystal.rotation.y;
        crystal.scale.setScalar(size);
        this.oreGlowGroup.add(crystal);
        crystals.push(crystal);
        crystalMaterials.push(material);
      }

      this.oreGlows.push({
        rim,
        rig,
        pumpJack: rig.getObjectByName('pumpJack') as Group,
        rimMaterial,
        statusMaterial: rig.getObjectByName('statusLight') instanceof Mesh ? (rig.getObjectByName('statusLight') as Mesh).material as MeshBasicMaterial : oreGlowMaterial(0x7df27d, 0.3),
        rigMaterials: rig.userData.materials as MeshStandardMaterial[],
        crystals,
        crystalMaterials,
        lastPct: Number.NaN,
      });
    }
  }

  private buildHighlandsOreDeposits(hf: Heightfield): void {
    const depositGeometry = createOreDepositGeometry();
    const matrix = new Matrix4();
    const quat = new Quaternion();
    const euler = new Euler();
    const pos = new Vector3();
    const scale = new Vector3();
    const tint = new Color();
    for (const field of hf.oreFields) {
      const rimMaterial = oreIndicatorMaterial(0xb8893a, 0.12);
      const rim = new Mesh(createTerrainDiscGeometry(hf, field.x, field.z, oreIndicatorRadius(field.radius), 32, 0.08), rimMaterial);
      rim.renderOrder = 22;
      rim.visible = false;
      this.oreGlowGroup.add(rim);

      const rig = createOilFieldRig(field.radius);
      rig.position.set(field.x, sampleHeight(hf, field.x, field.z) + 0.54, field.z);
      rig.rotation.y = hashAngle(field.x, field.z);
      this.oreGlowGroup.add(rig);

      const count = oreDepositCount(field.radius);
      const depositMaterial = new MeshStandardMaterial({
        color: 0x5c5346,
        emissive: 0x8a5a18,
        emissiveIntensity: 0.22,
        roughness: 0.84,
        metalness: 0.16,
      });
      const deposits = new InstancedMesh(depositGeometry, depositMaterial, count);
      const rng = mulberry32((Math.floor(field.x * 31) ^ Math.floor(field.z * 57) ^ 0x9e3779b9) >>> 0);
      for (let c = 0; c < count; c++) {
        const angle = rng() * Math.PI * 2;
        const distance = field.radius * (0.08 + rng() * 0.48);
        const x = field.x + Math.cos(angle) * distance;
        const z = field.z + Math.sin(angle) * distance;
        const size = 0.78 + rng() * 0.9;
        euler.set(rng() * 0.5 - 0.25, rng() * Math.PI * 2, rng() * 0.4 - 0.2);
        quat.setFromEuler(euler);
        pos.set(x, sampleHeight(hf, x, z) + size * 0.2, z);
        scale.set(size, size * (0.42 + rng() * 0.22), size);
        matrix.compose(pos, quat, scale);
        deposits.setMatrixAt(c, matrix);
        tint.setRGB(0.82 + rng() * 0.16, 0.72 + rng() * 0.14, 0.5 + rng() * 0.12);
        deposits.setColorAt(c, tint);
      }
      deposits.instanceMatrix.needsUpdate = true;
      if (deposits.instanceColor) deposits.instanceColor.needsUpdate = true;
      deposits.castShadow = false;
      deposits.receiveShadow = true;
      deposits.frustumCulled = true;
      deposits.visible = false;
      deposits.computeBoundingSphere();
      this.oreGlowGroup.add(deposits);

      this.oreGlows.push({
        rim,
        rig,
        pumpJack: rig.getObjectByName('pumpJack') as Group,
        rimMaterial,
        statusMaterial: rig.getObjectByName('statusLight') instanceof Mesh ? (rig.getObjectByName('statusLight') as Mesh).material as MeshBasicMaterial : oreGlowMaterial(0x7df27d, 0.3),
        rigMaterials: rig.userData.materials as MeshStandardMaterial[],
        deposits,
        depositMaterial,
        lastPct: Number.NaN,
      });
    }
  }
}

export function createTerrainSkirtGeometry(hf: Heightfield, thickness = 12): BufferGeometry {
  const { heights, samples, cellSize } = hf;
  const half = hf.size / 2;
  const perimeter: Array<Array<[number, number, number]>> = [[], [], [], []];
  let minEdgeHeight = Number.POSITIVE_INFINITY;
  const point = (gx: number, gz: number): [number, number, number] => {
    const y = heights[gz * samples + gx];
    minEdgeHeight = Math.min(minEdgeHeight, y);
    return [gx * cellSize - half, y, gz * cellSize - half];
  };
  for (let i = 0; i < samples; i++) perimeter[0].push(point(i, 0));
  for (let i = 0; i < samples; i++) perimeter[1].push(point(samples - 1, i));
  for (let i = samples - 1; i >= 0; i--) perimeter[2].push(point(i, samples - 1));
  for (let i = samples - 1; i >= 0; i--) perimeter[3].push(point(0, i));

  const bottomY = minEdgeHeight - Math.max(4, thickness);
  const vertexCount = perimeter.reduce((sum, edge) => sum + edge.length * 2, 0);
  const segmentCount = perimeter.reduce((sum, edge) => sum + edge.length - 1, 0);
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(segmentCount * 6);
  let vertex = 0;
  let index = 0;
  for (const edge of perimeter) {
    const edgeStart = vertex;
    for (const [x, y, z] of edge) {
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
      vertex++;
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = bottomY;
      positions[vertex * 3 + 2] = z;
      vertex++;
    }
    for (let segment = 0; segment < edge.length - 1; segment++) {
      const top = edgeStart + segment * 2;
      const bottom = top + 1;
      const nextTop = top + 2;
      const nextBottom = top + 3;
      indices[index++] = top;
      indices[index++] = nextTop;
      indices[index++] = bottom;
      indices[index++] = nextTop;
      indices[index++] = nextBottom;
      indices[index++] = bottom;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export function createTerrainDiscGeometry(
  hf: Heightfield,
  centerX: number,
  centerZ: number,
  radius: number,
  radialSegments = 64,
  lift = 0.16,
): BufferGeometry {
  const segments = Math.max(12, Math.floor(radialSegments));
  const rings = Math.max(4, Math.ceil(radius / Math.max(2, hf.cellSize * 1.5)));
  const vertexCount = 1 + rings * segments;
  const positions = new Float32Array(vertexCount * 3);
  positions[0] = centerX;
  positions[1] = sampleHeight(hf, centerX, centerZ) + lift;
  positions[2] = centerZ;

  for (let ring = 1; ring <= rings; ring++) {
    const ringRadius = radius * (ring / rings);
    for (let segment = 0; segment < segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * ringRadius;
      const z = centerZ + Math.sin(angle) * ringRadius;
      const vertex = 1 + (ring - 1) * segments + segment;
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = sampleHeight(hf, x, z) + lift;
      positions[vertex * 3 + 2] = z;
    }
  }

  const triangleCount = segments + (rings - 1) * segments * 2;
  const indices = new Uint32Array(triangleCount * 3);
  let offset = 0;
  for (let segment = 0; segment < segments; segment++) {
    const current = 1 + segment;
    const next = 1 + ((segment + 1) % segments);
    indices[offset++] = 0;
    indices[offset++] = next;
    indices[offset++] = current;
  }
  for (let ring = 2; ring <= rings; ring++) {
    const innerStart = 1 + (ring - 2) * segments;
    const outerStart = 1 + (ring - 1) * segments;
    for (let segment = 0; segment < segments; segment++) {
      const nextSegment = (segment + 1) % segments;
      const inner = innerStart + segment;
      const innerNext = innerStart + nextSegment;
      const outer = outerStart + segment;
      const outerNext = outerStart + nextSegment;
      indices[offset++] = inner;
      indices[offset++] = innerNext;
      indices[offset++] = outer;
      indices[offset++] = innerNext;
      indices[offset++] = outerNext;
      indices[offset++] = outer;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function oreGlowMaterial(color: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

function oreIndicatorMaterial(color: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: DoubleSide,
  });
}

function createOreDepositGeometry(): BufferGeometry {
  const rock = new IcosahedronGeometry(1, 0);
  const pos = rock.getAttribute('position');
  const rng = mulberry32(0x0e11);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.72 + rng() * 0.5;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.58, pos.getZ(i) * k);
  }
  rock.computeVertexNormals();
  return rock;
}

export function oreDepositCount(radius: number): number {
  return Math.max(6, Math.round(radius * 0.42));
}

export function oreIndicatorRadius(radius: number): number {
  return radius * 0.64;
}

function createOilFieldRig(radius: number): Group {
  const root = new Group();
  const steel = rigMaterial(0x354044, 0x111413);
  const dark = rigMaterial(0x202423, 0x090a09);
  const brass = rigMaterial(0xc79a46, 0x493720);
  const pipe = rigMaterial(0x4d5350, 0x171918);
  const materials = [steel, dark, brass, pipe];
  root.userData.materials = materials;

  const base = new Mesh(new CylinderGeometry(2.4, 2.6, 0.32, 18), dark);
  base.position.set(radius * 0.18, 0.18, -radius * 0.08);
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const tower = new Group();
  tower.position.set(radius * 0.2, 0.3, -radius * 0.08);
  root.add(tower);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new Mesh(new BoxGeometry(0.18, 4.2, 0.18), steel);
      leg.position.set(sx * 0.9, 2.0, sz * 0.65);
      leg.rotation.z = sx * 0.13;
      leg.rotation.x = -sz * 0.08;
      leg.castShadow = true;
      tower.add(leg);
    }
  }
  const crown = new Mesh(new BoxGeometry(2.0, 0.26, 1.45), steel);
  crown.position.y = 4.05;
  crown.castShadow = true;
  tower.add(crown);
  const crossA = new Mesh(new BoxGeometry(2.3, 0.13, 0.13), brass);
  crossA.position.y = 2.55;
  crossA.rotation.z = 0.58;
  tower.add(crossA);
  const crossB = new Mesh(new BoxGeometry(2.3, 0.13, 0.13), brass);
  crossB.position.y = 2.55;
  crossB.rotation.z = -0.58;
  tower.add(crossB);

  const pump = new Group();
  pump.name = 'pumpJack';
  pump.position.set(-radius * 0.28, 1.05, radius * 0.1);
  root.add(pump);
  const beam = new Mesh(new BoxGeometry(3.8, 0.28, 0.22), brass);
  beam.castShadow = true;
  pump.add(beam);
  const head = new Mesh(new BoxGeometry(0.55, 1.2, 0.34), brass);
  head.position.set(1.9, -0.45, 0);
  head.castShadow = true;
  pump.add(head);
  const counter = new Mesh(new CylinderGeometry(0.52, 0.52, 0.3, 14), dark);
  counter.rotation.z = Math.PI / 2;
  counter.position.set(-1.95, -0.18, 0);
  counter.castShadow = true;
  pump.add(counter);

  const pipeA = new Mesh(new CylinderGeometry(0.16, 0.16, radius * 0.72, 12), pipe);
  pipeA.rotation.z = Math.PI / 2;
  pipeA.position.set(0.2, 0.42, radius * 0.38);
  pipeA.castShadow = true;
  root.add(pipeA);
  const tankA = new Mesh(new CylinderGeometry(0.68, 0.68, 1.7, 16), pipe);
  tankA.rotation.z = Math.PI / 2;
  tankA.position.set(-radius * 0.38, 0.78, -radius * 0.32);
  tankA.castShadow = true;
  root.add(tankA);
  const tankB = new Mesh(new CylinderGeometry(0.52, 0.52, 1.35, 16), pipe);
  tankB.rotation.z = Math.PI / 2;
  tankB.position.set(-radius * 0.5, 0.62, -radius * 0.48);
  tankB.castShadow = true;
  root.add(tankB);

  const status = new Mesh(
    new CircleGeometry(0.95, 24),
    new MeshBasicMaterial({ color: 0x7df27d, transparent: true, opacity: 0.38, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, toneMapped: false }),
  );
  status.name = 'statusLight';
  status.rotation.x = -Math.PI / 2;
  status.position.set(radius * 0.2, 0.06, -radius * 0.08);
  status.renderOrder = 25;
  root.add(status);

  root.scale.setScalar(0.82);
  return root;
}

function rigMaterial(fullColor: number, depletedColor: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: fullColor, roughness: 0.82, metalness: 0.16, transparent: true, opacity: 1 });
  material.userData.fullColor = material.color.clone();
  material.userData.depletedColor = material.color.clone().setHex(depletedColor);
  return material;
}

function hashAngle(x: number, z: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * Math.PI * 2;
}

function createSplatMaterial(
  hf: Heightfield,
  csm: CSM | undefined,
  maxAnisotropy: number,
  macroTint: MacroTintMap,
  groundRealism: boolean,
): MeshStandardMaterial {
  const style = terrainTextureStyle(hf);
  const grass = createGrassTexture(style);
  const dirt = createDirtTexture(style);
  const rock = createRockTexture(style);
  const ore = createOreTexture();
  const detailNormal = createDetailNormalTexture(grass);
  const aniso = Math.min(8, maxAnisotropy);
  for (const t of [grass, dirt, rock, ore, detailNormal]) t.anisotropy = aniso;

  const splatTex = new DataTexture(new Uint8Array(hf.splat), hf.samples, hf.samples, RGBAFormat);
  splatTex.minFilter = LinearFilter;
  splatTex.magFilter = LinearFilter;
  splatTex.needsUpdate = true;

  const material = new MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
  material.defines = { USE_UV: '' };

  // CSM patches shadows via onBeforeCompile; wrap it so our splat patch composes.
  csm?.setupMaterial(material);
  const csmCompile = material.onBeforeCompile;
  const tiling = hf.size / 9; // one detail tile every 9 m
  if (groundRealism) {
    material.normalMap = detailNormal;
    material.normalScale.set(0.52, 0.52);
    detailNormal.repeat.set(tiling, tiling);
    detailNormal.updateMatrix();
  }
  material.customProgramCacheKey = () => `terrain-ground-realism-${groundRealism ? 1 : 0}`;

  material.onBeforeCompile = (shader, renderer) => {
    csmCompile?.call(material, shader, renderer);
    shader.uniforms.uSplat = { value: splatTex };
    shader.uniforms.uGrass = { value: grass };
    shader.uniforms.uDirt = { value: dirt };
    shader.uniforms.uRock = { value: rock };
    shader.uniforms.uOre = { value: ore };
    shader.uniforms.uMacroTint = { value: macroTint.texture };
    shader.uniforms.uTiling = { value: tiling };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>
        uniform sampler2D uSplat;
        uniform sampler2D uGrass;
        uniform sampler2D uDirt;
        uniform sampler2D uRock;
        uniform sampler2D uOre;
        uniform sampler2D uMacroTint;
        uniform float uTiling;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec4 splatW = texture2D(uSplat, vUv);
          splatW /= max(splatW.r + splatW.g + splatW.b + splatW.a, 1e-4);
          vec2 tUv = vUv * uTiling;
          vec2 rotatedUv = mat2(0.819152, -0.573576, 0.573576, 0.819152) * tUv * 0.371 + vec2(17.13, 41.79);
          vec3 splatCol = vec3(0.0);
          if (splatW.r > 0.015) splatCol += splatW.r * mix(texture2D(uGrass, tUv).rgb, texture2D(uGrass, rotatedUv).rgb, ${groundRealism ? '0.45' : '0.0'});
          if (splatW.g > 0.015) splatCol += splatW.g * mix(texture2D(uDirt, tUv).rgb, texture2D(uDirt, rotatedUv).rgb, ${groundRealism ? '0.45' : '0.0'});
          if (splatW.b > 0.015) splatCol += splatW.b * mix(texture2D(uRock, tUv).rgb, texture2D(uRock, rotatedUv).rgb, ${groundRealism ? '0.45' : '0.0'});
          if (splatW.a > 0.015) splatCol += splatW.a * texture2D(uOre, tUv).rgb;
          vec3 macroTint = mix(vec3(0.68), vec3(1.32), texture2D(uMacroTint, vUv).rgb);
          macroTint = clamp(vec3(1.0) + (macroTint - vec3(1.0)) * 2.35, vec3(0.58), vec3(1.42));
          splatCol *= ${groundRealism ? 'macroTint' : 'vec3(1.0)'};
          diffuseColor.rgb *= splatCol;
        }`,
      );
  };
  return material;
}

function terrainTextureStyle(hf: Heightfield): TerrainTextureStyle {
  if (hf.kind === 'crater-oasis') return 'desert';
  if (hf.kind === 'frostbite-pass') return 'snow';
  return 'temperate';
}

function terrainSkirtColor(hf: Heightfield): number {
  if (hf.kind === 'crater-oasis') return 0x3b3027;
  if (hf.kind === 'frostbite-pass') return 0x30383d;
  return 0x4a453a;
}

function createWalkOverlayMaterial(hf: Heightfield): MeshBasicMaterial {
  const { cells, walkable } = hf;
  const data = new Uint8Array(cells * cells * 4);
  for (let i = 0; i < walkable.length; i++) {
    if (walkable[i]) {
      data[i * 4] = 60;
      data[i * 4 + 1] = 220;
      data[i * 4 + 2] = 120;
      data[i * 4 + 3] = 26;
    } else {
      data[i * 4] = 255;
      data[i * 4 + 1] = 45;
      data[i * 4 + 2] = 45;
      data[i * 4 + 3] = 210;
    }
  }
  const tex = new DataTexture(data, cells, cells, RGBAFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    toneMapped: false,
  });
}
