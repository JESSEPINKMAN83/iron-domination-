// Scatters map-specific low-poly vegetation and rocks on valid terrain.
// Placement is seed-deterministic and uses broad density fields so trees form
// readable groves with open combat lanes instead of an even wallpaper.
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

function spruceGeometry(style: Heightfield['kind'] = 'highlands'): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.14, 0.22, 2.1, 6).translate(0, 1.05, 0), new Color('#60432f'));
  const colors = style === 'frostbite-pass'
    ? ['#617b76', '#78928c', '#a7bab5', '#d5e0dc']
    : ['#244d32', '#285c36', '#316b3d', '#3b7945'];
  const layers = [
    paint(new ConeGeometry(1.42, 2.3, 7).translate(0, 2.5, 0), new Color(colors[0])),
    paint(new ConeGeometry(1.15, 2.15, 7).translate(0, 3.7, 0), new Color(colors[1])),
    paint(new ConeGeometry(0.86, 1.95, 7).translate(0, 4.85, 0), new Color(colors[2])),
    paint(new ConeGeometry(0.55, 1.55, 7).translate(0, 5.85, 0), new Color(colors[3])),
  ];
  return mergeGeometries([trunk, ...layers]);
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

function birchGeometry(rng: () => number, style: Heightfield['kind'] = 'highlands'): BufferGeometry {
  const winter = style === 'frostbite-pass';
  const trunk = paint(
    new CylinderGeometry(0.13, 0.2, 3.2, 7).translate(0, 1.6, 0),
    new Color(winter ? '#c6c9c3' : '#d7d2bd'),
  );
  const crownColors = winter
    ? ['#9daea9', '#c4d0cc', '#dbe3e0']
    : ['#769145', '#89a94f', '#a1b85b'];
  const crowns: BufferGeometry[] = [];
  const placements = [
    [-0.7, 3.35, 0.05, 0.82],
    [0.58, 3.65, 0.18, 0.92],
    [-0.05, 4.35, -0.08, 1.02],
  ] as const;
  placements.forEach(([x, y, z, size], index) => {
    const crown = new IcosahedronGeometry(1, 1);
    const pos = crown.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const k = 0.82 + rng() * 0.32;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    crown.scale(size, size * 0.9, size);
    crown.translate(x, y, z);
    crowns.push(paint(crown, new Color(crownColors[index])));
  });
  return mergeGeometries([trunk, ...crowns]);
}

function acaciaGeometry(rng: () => number): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.17, 0.29, 2.5, 6).translate(0, 1.25, 0), new Color('#735438'));
  const branchA = paint(
    new CylinderGeometry(0.09, 0.14, 1.7, 6).rotateZ(-0.62).translate(0.48, 2.25, 0),
    new Color('#735438'),
  );
  const branchB = paint(
    new CylinderGeometry(0.08, 0.13, 1.45, 6).rotateZ(0.76).translate(-0.42, 2.35, 0.08),
    new Color('#735438'),
  );
  const crowns: BufferGeometry[] = [];
  const placements = [
    [-0.72, 3.2, 0, 1.38],
    [0.65, 3.3, 0.1, 1.48],
    [0, 3.55, -0.08, 1.25],
  ] as const;
  placements.forEach(([x, y, z, size], index) => {
    const crown = new IcosahedronGeometry(1, 1);
    const pos = crown.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const k = 0.82 + rng() * 0.28;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    crown.scale(size, size * 0.38, size * 0.85);
    crown.translate(x, y, z);
    crowns.push(paint(crown, new Color(index === 1 ? '#718147' : '#657541')));
  });
  return mergeGeometries([trunk, branchA, branchB, ...crowns]);
}

function snagGeometry(style: Heightfield['kind'] = 'highlands'): BufferGeometry {
  const wood = new Color(style === 'frostbite-pass' ? '#7a706a' : style === 'crater-oasis' ? '#7b5d3c' : '#5f4938');
  const trunk = paint(new CylinderGeometry(0.12, 0.3, 3.5, 6).translate(0, 1.75, 0), wood);
  const branchA = paint(
    new CylinderGeometry(0.055, 0.11, 1.5, 5).rotateZ(-0.78).translate(0.45, 2.45, 0),
    wood,
  );
  const branchB = paint(
    new CylinderGeometry(0.05, 0.1, 1.25, 5).rotateZ(0.9).translate(-0.38, 2.85, 0.06),
    wood,
  );
  return mergeGeometries([trunk, branchA, branchB]);
}

function shrubGeometry(rng: () => number, style: Heightfield['kind'] = 'highlands'): BufferGeometry {
  const colors = style === 'frostbite-pass'
    ? ['#71847e', '#9aaba5']
    : style === 'crater-oasis'
      ? ['#777143', '#938052']
      : ['#426b3c', '#557e45'];
  const parts: BufferGeometry[] = [];
  const placements = [
    [-0.45, 0.52, 0, 0.72],
    [0.35, 0.62, 0.1, 0.82],
    [0, 0.76, -0.2, 0.68],
  ] as const;
  placements.forEach(([x, y, z, size], index) => {
    const crown = new IcosahedronGeometry(1, 1);
    const pos = crown.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const k = 0.76 + rng() * 0.42;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    crown.scale(size, size * 0.68, size);
    crown.translate(x, y, z);
    parts.push(paint(crown, new Color(colors[index % colors.length])));
  });
  return mergeGeometries(parts);
}

function fallenLogGeometry(style: Heightfield['kind'] = 'highlands'): BufferGeometry {
  const bark = style === 'frostbite-pass' ? '#756d67' : style === 'crater-oasis' ? '#76583b' : '#594334';
  const log = paint(new CylinderGeometry(0.32, 0.38, 3.2, 7).rotateZ(Math.PI / 2).translate(0, 0.32, 0), new Color(bark));
  const broken = paint(new ConeGeometry(0.3, 0.7, 6).rotateZ(-Math.PI / 2).translate(1.92, 0.32, 0), new Color('#9a7852'));
  return mergeGeometries([log, broken]);
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
  isVegetation: boolean;
}

export const VEGETATION_COUNTS = {
  highlands: {
    spruce: 720,
    pine: 420,
    broadleaf: 500,
    birch: 320,
    snag: 110,
    shrub: 460,
    fallenLog: 90,
  },
  'crater-oasis': {
    acacia: 230,
    broadleaf: 140,
    snag: 90,
    shrub: 360,
    fallenLog: 55,
  },
  'frostbite-pass': {
    spruce: 520,
    pine: 260,
    birch: 180,
    snag: 80,
    shrub: 220,
    fallenLog: 65,
  },
} as const satisfies Record<Heightfield['kind'], Record<string, number>>;

function scatterDefs(kind: Heightfield['kind'], rng: () => number): ScatterDef[] {
  const rocks = kind === 'crater-oasis' ? 1.45 : kind === 'frostbite-pass' ? 1.25 : 1;
  const commonRocks: ScatterDef[] = [
    { name: 'rock-a', geometry: rockGeometry(rng, 0.72, kind), count: Math.round(800 * rocks), scaleMin: 0.5, scaleMax: 1.9, maxSlope: 0.9, isTree: false, isVegetation: false },
    { name: 'rock-b', geometry: rockGeometry(rng, 0.45, kind), count: Math.round(700 * rocks), scaleMin: 0.4, scaleMax: 1.5, maxSlope: 0.9, isTree: false, isVegetation: false },
  ];
  if (kind === 'crater-oasis') {
    const counts = VEGETATION_COUNTS['crater-oasis'];
    return [
      { name: 'acacia', geometry: acaciaGeometry(rng), count: counts.acacia, scaleMin: 0.76, scaleMax: 1.35, maxSlope: 0.48, isTree: true, isVegetation: true },
      { name: 'oasis-broadleaf', geometry: broadleafGeometry(rng, kind), count: counts.broadleaf, scaleMin: 0.7, scaleMax: 1.18, maxSlope: 0.48, isTree: true, isVegetation: true },
      { name: 'desert-snag', geometry: snagGeometry(kind), count: counts.snag, scaleMin: 0.68, scaleMax: 1.22, maxSlope: 0.58, isTree: true, isVegetation: true },
      { name: 'desert-shrub', geometry: shrubGeometry(rng, kind), count: counts.shrub, scaleMin: 0.48, scaleMax: 1.18, maxSlope: 0.7, isTree: false, isVegetation: true },
      { name: 'desert-log', geometry: fallenLogGeometry(kind), count: counts.fallenLog, scaleMin: 0.6, scaleMax: 1.12, maxSlope: 0.42, isTree: false, isVegetation: true },
      ...commonRocks,
    ];
  }
  if (kind === 'frostbite-pass') {
    const counts = VEGETATION_COUNTS['frostbite-pass'];
    return [
      { name: 'frost-spruce', geometry: spruceGeometry(kind), count: counts.spruce, scaleMin: 0.72, scaleMax: 1.5, maxSlope: 0.52, isTree: true, isVegetation: true },
      { name: 'frost-pine', geometry: pineGeometry(kind), count: counts.pine, scaleMin: 0.66, scaleMax: 1.32, maxSlope: 0.52, isTree: true, isVegetation: true },
      { name: 'frost-birch', geometry: birchGeometry(rng, kind), count: counts.birch, scaleMin: 0.7, scaleMax: 1.25, maxSlope: 0.48, isTree: true, isVegetation: true },
      { name: 'frost-snag', geometry: snagGeometry(kind), count: counts.snag, scaleMin: 0.7, scaleMax: 1.3, maxSlope: 0.56, isTree: true, isVegetation: true },
      { name: 'frost-shrub', geometry: shrubGeometry(rng, kind), count: counts.shrub, scaleMin: 0.5, scaleMax: 1.08, maxSlope: 0.66, isTree: false, isVegetation: true },
      { name: 'frost-log', geometry: fallenLogGeometry(kind), count: counts.fallenLog, scaleMin: 0.62, scaleMax: 1.1, maxSlope: 0.42, isTree: false, isVegetation: true },
      ...commonRocks,
    ];
  }
  const counts = VEGETATION_COUNTS.highlands;
  return [
    { name: 'highland-spruce', geometry: spruceGeometry(kind), count: counts.spruce, scaleMin: 0.72, scaleMax: 1.48, maxSlope: 0.52, isTree: true, isVegetation: true },
    { name: 'highland-pine', geometry: pineGeometry(kind), count: counts.pine, scaleMin: 0.68, scaleMax: 1.36, maxSlope: 0.52, isTree: true, isVegetation: true },
    { name: 'highland-broadleaf', geometry: broadleafGeometry(rng, kind), count: counts.broadleaf, scaleMin: 0.7, scaleMax: 1.38, maxSlope: 0.48, isTree: true, isVegetation: true },
    { name: 'highland-birch', geometry: birchGeometry(rng, kind), count: counts.birch, scaleMin: 0.72, scaleMax: 1.3, maxSlope: 0.48, isTree: true, isVegetation: true },
    { name: 'highland-snag', geometry: snagGeometry(kind), count: counts.snag, scaleMin: 0.7, scaleMax: 1.25, maxSlope: 0.58, isTree: true, isVegetation: true },
    { name: 'highland-shrub', geometry: shrubGeometry(rng, kind), count: counts.shrub, scaleMin: 0.5, scaleMax: 1.15, maxSlope: 0.68, isTree: false, isVegetation: true },
    { name: 'highland-log', geometry: fallenLogGeometry(kind), count: counts.fallenLog, scaleMin: 0.65, scaleMax: 1.12, maxSlope: 0.42, isTree: false, isVegetation: true },
    ...commonRocks,
  ];
}

function woodlandAffinity(kind: Heightfield['kind'], x: number, z: number, seed: number): number {
  const salt = seed * 0.000013;
  const broad = Math.sin(x * 0.013 + salt) * Math.cos(z * 0.016 - salt * 1.7);
  const medium = Math.sin((x + z) * 0.027 - salt * 0.6) * 0.48;
  const fine = Math.cos((x - z) * 0.041 + salt * 2.1) * 0.2;
  const biomeBias = kind === 'crater-oasis' ? -0.15 : kind === 'frostbite-pass' ? -0.04 : 0.08;
  return Math.max(0.08, Math.min(0.96, 0.5 + broad * 0.34 + medium + fine + biomeBias));
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
  const kind = hf.kind;
  const defs = scatterDefs(kind, rng);

  const view = new ScatterView();
  const bound = hf.size / 2 - 12;
  // Preserve the intended spacing across map sizes. Small maps no longer get
  // the full medium-map forest squeezed into a tighter battlefield.
  const mapAreaScale = Math.max(0.65, Math.min(1.45, (hf.size / 1024) ** 2));
  for (const def of defs) {
    const targetCount = Math.round(def.count * mapAreaScale);
    const list: InstanceTransform[] = [];
    let guard = 0;
    while (list.length < targetCount && guard++ < targetCount * 80) {
      const x = (rng() * 2 - 1) * bound;
      const z = (rng() * 2 - 1) * bound;
      const h = sampleHeight(hf, x, z);
      if (h < hf.waterLevel + 0.9) continue;
      const gx = Math.abs(sampleHeight(hf, x + 1.4, z) - sampleHeight(hf, x - 1.4, z)) / 2.8;
      const gz = Math.abs(sampleHeight(hf, x, z + 1.4) - sampleHeight(hf, x, z - 1.4)) / 2.8;
      if (Math.max(gx, gz) > def.maxSlope) continue;
      if (hf.oreFields.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < (f.radius + 6) ** 2)) continue;
      if (def.isVegetation) {
        const affinity = woodlandAffinity(kind, x, z, seed);
        const chance = def.isTree ? 0.16 + affinity * 0.82 : 0.34 + affinity * 0.58;
        if (rng() > chance) continue;
      }

      const v = 0.78 + rng() * 0.4;
      const tint =
        def.isVegetation && kind === 'frostbite-pass'
          ? new Color(v * 0.92, v, v * 1.06)
          : def.isVegetation && kind === 'crater-oasis'
            ? new Color(v * 1.08, v * 0.94, v * 0.72)
            : def.isVegetation
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
