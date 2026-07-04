// Scatters 5,000 instanced low-poly trees and rocks on valid terrain
// (dry, not too steep, outside ore fields). Placement is seed-deterministic.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../sim/noise';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import type { InstancedMeshRegistry, InstanceTransform } from './instancing';

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

function pineGeometry(): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.16, 0.24, 1.6, 6).translate(0, 0.8, 0), new Color('#6b4a2f'));
  const c1 = paint(new ConeGeometry(1.5, 2.4, 7).translate(0, 2.4, 0), new Color('#2f5c33'));
  const c2 = paint(new ConeGeometry(1.1, 2.0, 7).translate(0, 3.8, 0), new Color('#356839'));
  const c3 = paint(new ConeGeometry(0.7, 1.6, 7).translate(0, 5.0, 0), new Color('#3c7440'));
  return mergeGeometries([trunk, c1, c2, c3]);
}

function broadleafGeometry(rng: () => number): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0), new Color('#71513a'));
  const canopy = new IcosahedronGeometry(1.7, 1);
  const pos = canopy.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 0.85 + rng() * 0.3;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  canopy.scale(1, 0.85, 1);
  canopy.translate(0, 3.0, 0);
  paint(canopy, new Color('#3f7a37'));
  return mergeGeometries([trunk, canopy]);
}

function rockGeometry(rng: () => number, flatten: number): BufferGeometry {
  const rock = new IcosahedronGeometry(1, 1);
  const pos = rock.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 0.75 + rng() * 0.55;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * flatten, pos.getZ(i) * k);
  }
  rock.computeVertexNormals();
  return paint(rock, new Color('#8a8d90'));
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
): ScatterView {
  const rng = mulberry32(seed);
  const defs: ScatterDef[] = [
    { name: 'pine', geometry: pineGeometry(), count: 2200, scaleMin: 0.7, scaleMax: 1.5, maxSlope: 0.5, isTree: true },
    { name: 'broadleaf', geometry: broadleafGeometry(rng), count: 1300, scaleMin: 0.7, scaleMax: 1.4, maxSlope: 0.5, isTree: true },
    { name: 'rock-a', geometry: rockGeometry(rng, 0.72), count: 800, scaleMin: 0.5, scaleMax: 1.9, maxSlope: 0.9, isTree: false },
    { name: 'rock-b', geometry: rockGeometry(rng, 0.45), count: 700, scaleMin: 0.4, scaleMax: 1.5, maxSlope: 0.9, isTree: false },
  ];

  const view = new ScatterView();
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
      const tint = def.isTree ? new Color(v * (0.92 + rng() * 0.12), v, v * (0.9 + rng() * 0.1)) : new Color(v, v, v);
      list.push({
        x,
        y: h - 0.15,
        z,
        rotY: rng() * Math.PI * 2,
        scale: def.scaleMin + rng() * (def.scaleMax - def.scaleMin),
        tint,
      });
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
  return view;
}
