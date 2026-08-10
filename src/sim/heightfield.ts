// Terrain data generation: heights, walkability, splat weights, ore fields.
// Fully deterministic from the map seed. No rendering dependencies.
import { fbm2, mulberry32, smoothstep } from './noise';

export type MapKind = 'highlands' | 'crater-oasis' | 'frostbite-pass';

export interface MapConfig {
  seed: number;
  kind?: MapKind;
  /** cells per side of the walkability grid (heights have cells+1 samples per side) */
  cells: number;
  /** world meters per cell */
  cellSize: number;
  waterLevel: number;
  oreFieldCount: number;
  /** Percentage multiplier for broad terrain elevation and canyon depth. */
  terrainRelief?: number;
}

export interface OreField {
  x: number;
  z: number;
  radius: number;
}

export interface Heightfield {
  kind: MapKind;
  cells: number;
  cellSize: number;
  /** world size in meters per side */
  size: number;
  /** height samples per side (= cells + 1) */
  samples: number;
  waterLevel: number;
  maxHeight: number;
  /** samples×samples row-major (row = z) */
  heights: Float32Array;
  /** cells×cells, 1 = walkable */
  walkable: Uint8Array;
  /** samples×samples RGBA terrain weights. R=base biome, G=loose ground, B=rock/ice, A=ore */
  splat: Uint8Array;
  oreFields: OreField[];
}

const MAX_WALKABLE_EDGE_GRADE = 0.82;

function sampleHeightData(heights: Float32Array, samples: number, cellSize: number, x: number, z: number): number {
  const half = ((samples - 1) * cellSize) / 2;
  const fx = Math.min(Math.max((x + half) / cellSize, 0), samples - 1.001);
  const fz = Math.min(Math.max((z + half) / cellSize, 0), samples - 1.001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * samples + ix;
  const h00 = heights[i];
  const h10 = heights[i + 1];
  const h01 = heights[i + samples];
  const h11 = heights[i + samples + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

export function sampleHeight(hf: Heightfield, x: number, z: number): number {
  return sampleHeightData(hf.heights, hf.samples, hf.cellSize, x, z);
}

/** True when the terrain stays below a direct sight/fire segment. */
export function hasTerrainLineOfSight(
  hf: Heightfield,
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  clearance = 0.55,
): boolean {
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(2, Math.min(32, Math.ceil(distance / Math.max(8, hf.cellSize * 5))));
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const x = fromX + (toX - fromX) * t;
    const z = fromZ + (toZ - fromZ) * t;
    const sightY = fromY + (toY - fromY) * t;
    if (sampleHeight(hf, x, z) + clearance >= sightY) return false;
  }
  return true;
}

export function generateHeightfield(cfg: MapConfig): Heightfield {
  const { seed, cells, cellSize, waterLevel } = cfg;
  const kind = cfg.kind ?? 'highlands';
  const samples = cells + 1;
  const size = cells * cellSize;
  const half = size / 2;
  const reliefScale = Math.max(0.5, Math.min(1.5, (cfg.terrainRelief ?? 100) / 100));

  // --- heights: rolling continent + broad mountain shelves + detail, basins for lakes ---
  const heights = new Float32Array(samples * samples);
  let maxHeight = 0;
  for (let gy = 0; gy < samples; gy++) {
    for (let gx = 0; gx < samples; gx++) {
      const wx = gx * cellSize - half;
      const wz = gy * cellSize - half;
      const continent = fbm2(wx * 0.0011 + 3.7, wz * 0.0011 - 8.2, seed, 4);
      const plate = fbm2(wx * 0.0019 + 41.3, wz * 0.0019 + 17.9, seed ^ 0x51bd, 3);
      const mask = smoothstep(0.34, 0.62, continent);
      // Keep local ground undulation broad enough to drive across. Large-scale
      // features provide the drama; high-frequency noise must not create tiny,
      // visually shallow trenches with cliff-grade edges.
      const rolling = (fbm2(wx * 0.009, wz * 0.009, seed ^ 0x9e37, 3) - 0.5) * 2.2;
      const basin = smoothstep(0.4, 0.22, continent);
      const noisyLake = smoothstep(0.3, 0.16, fbm2(wx * 0.0031 - 19.7, wz * 0.0031 + 73.4, seed ^ 0xa17e, 3));
      const basinA = smoothstep(size * 0.16, size * 0.07, Math.hypot(wx + size * 0.24, wz - size * 0.16));
      const basinB = smoothstep(size * 0.12, size * 0.05, Math.hypot(wx - size * 0.18, wz + size * 0.22));
      const lakePocket = Math.max(noisyLake, basinA, basinB);
      let h =
        4.0 +
        continent * 8.0 +
        plate * 34.0 * mask +
        rolling -
        basin * 18.0 -
        lakePocket * 9.0;
      h = waterLevel + (h - waterLevel) * reliefScale;
      if (kind === 'crater-oasis') {
        const r = Math.hypot(wx, wz);
        const angle = Math.atan2(wz, wx);
        const crater = smoothstep(size * 0.19, size * 0.045, r);
        const innerRim = smoothstep(size * 0.12, size * 0.2, r);
        const outerRim = smoothstep(size * 0.34, size * 0.25, r);
        const diagonalGates = smoothstep(0.2, 0.035, Math.abs(Math.cos(angle * 2)));
        const brokenRim = innerRim * outerRim * (1 - diagonalGates * 0.72);
        const outerPlateau = smoothstep(size * 0.42, size * 0.22, r);
        // Broad sandstone shelves split by two navigable washes. The
        // relief slider changes the tactical height difference without adding
        // extra geometry or runtime simulation cost.
        const mesaNoise = fbm2(wx * 0.00145 + 12.7, wz * 0.00145 - 31.2, seed ^ 0xd35e, 4);
        const mesaShelf = smoothstep(0.44, 0.67, mesaNoise);
        const primaryWashDistance = Math.abs(wz - Math.sin(wx * 0.0062 + 0.6) * size * 0.075);
        const crossingWashDistance = Math.abs(wx + Math.sin(wz * 0.0054 - 1.1) * size * 0.06);
        const primaryWash = smoothstep(size * 0.12, size * 0.035, primaryWashDistance);
        const crossingWash = smoothstep(size * 0.09, size * 0.028, crossingWashDistance);
        const washCut = Math.max(primaryWash, crossingWash * 0.78) * smoothstep(size * 0.48, size * 0.1, r);
        const rimRelief = brokenRim * 23.0 - crater * 24.0 + outerPlateau * 4.0;
        const canyonRelief = mesaShelf * 34.0 - washCut * 22.0;
        h += (rimRelief + canyonRelief) * reliefScale;
        // The oasis remains the only intentional water pocket; canyon floors
        // stay dry so vehicles can use them as concealed approach routes.
        if (r > size * 0.12) h = Math.max(h, waterLevel + 1.15);
      } else if (kind === 'frostbite-pass') {
        const ridgeA = smoothstep(90, 10, Math.abs(wx + size * 0.23 + Math.sin(wz * 0.009) * 42));
        const ridgeB = smoothstep(82, 12, Math.abs(wx - size * 0.25 + Math.sin(wz * 0.008 + 1.7) * 38));
        const pass = smoothstep(size * 0.11, size * 0.028, Math.abs(wz + Math.sin(wx * 0.006) * 38));
        const frozenBasin = smoothstep(size * 0.19, size * 0.05, Math.hypot(wx, wz - size * 0.04));
        const northShelf = smoothstep(size * 0.46, size * 0.18, Math.abs(wz - size * 0.3));
        h += (ridgeA * 26.0 + ridgeB * 24.0 + northShelf * 6.0 - pass * 16.0 - frozenBasin * 18.0) * reliefScale;
      }
      heights[gy * samples + gx] = h;
      if (h > maxHeight) maxHeight = h;
    }
  }

  // Every starting command yard receives a deterministic, broad construction
  // shelf with a blended shoulder. Deep maps remain dramatic without spawning
  // buildings inside a cliff or trapping the opening army.
  flattenDeploymentShelves(heights, samples, cellSize, size);
  maxHeight = 0;
  for (let i = 0; i < heights.length; i++) maxHeight = Math.max(maxHeight, heights[i]);

  // --- ore fields: flat, dry, mutually spaced spots ---
  const rng = mulberry32(seed ^ 0x0be5);
  const oreFields: OreField[] = [];
  const minSpacing =
    kind === 'crater-oasis' ? Math.min(116, size * 0.22) : kind === 'frostbite-pass' ? Math.min(108, size * 0.2) : Math.min(150, size * 0.3);
  if (kind === 'crater-oasis') {
    const anchors = [
      [-0.28, -0.3],
      [0.28, 0.3],
      [0.3, -0.28],
      [-0.3, 0.28],
      [0, -0.34],
      [0, 0.34],
      [-0.34, 0],
      [0.34, 0],
    ];
    for (const [ax, az] of anchors) {
      const found = findOreSpotNear(heights, samples, cellSize, size, waterLevel, ax * size, az * size, rng, oreFields, minSpacing * 0.74, kind);
      if (found) oreFields.push(found);
      if (oreFields.length >= cfg.oreFieldCount) break;
    }
  } else if (kind === 'frostbite-pass') {
    const anchors = [
      [-0.36, -0.34],
      [0.36, 0.34],
      [-0.34, 0.28],
      [0.34, -0.28],
      [0, -0.36],
      [0, 0.36],
      [0, 0],
    ];
    for (const [ax, az] of anchors) {
      const found = findOreSpotNear(heights, samples, cellSize, size, waterLevel, ax * size, az * size, rng, oreFields, minSpacing * 0.68, kind);
      if (found) oreFields.push(found);
      if (oreFields.length >= cfg.oreFieldCount) break;
    }
  }
  let guard = 0;
  while (oreFields.length < cfg.oreFieldCount && guard++ < 6000) {
    const x = (rng() * 1.4 - 0.7) * half;
    const z = (rng() * 1.4 - 0.7) * half;
    const h = sampleHeightData(heights, samples, cellSize, x, z);
    if (h < waterLevel + 1.2) continue;
    const sx = Math.abs(sampleHeightData(heights, samples, cellSize, x + 3, z) - sampleHeightData(heights, samples, cellSize, x - 3, z)) / 6;
    const sz = Math.abs(sampleHeightData(heights, samples, cellSize, x, z + 3) - sampleHeightData(heights, samples, cellSize, x, z - 3)) / 6;
    if (Math.max(sx, sz) > 0.22) continue;
    if (oreFields.some((f) => (f.x - x) ** 2 + (f.z - z) ** 2 < minSpacing ** 2)) continue;
    oreFields.push({ x, z, radius: oreRadius(kind, rng) });
  }

  // --- splat weights: rock on steep slopes, dirt near shores/patches, ore stains, grass elsewhere ---
  const splat = new Uint8Array(samples * samples * 4);
  for (let gy = 0; gy < samples; gy++) {
    for (let gx = 0; gx < samples; gx++) {
      const i = gy * samples + gx;
      const wx = gx * cellSize - half;
      const wz = gy * cellSize - half;
      const hC = heights[i];
      const hL = heights[gy * samples + Math.max(gx - 1, 0)];
      const hR = heights[gy * samples + Math.min(gx + 1, samples - 1)];
      const hD = heights[Math.max(gy - 1, 0) * samples + gx];
      const hU = heights[Math.min(gy + 1, samples - 1) * samples + gx];
      const slope = Math.max(Math.abs(hR - hL), Math.abs(hU - hD)) / (2 * cellSize);

      const rockW = smoothstep(0.5, 1.05, slope);
      const shore = smoothstep(waterLevel + 2.2, waterLevel + 0.4, hC);
      const patch = smoothstep(0.56, 0.72, fbm2(wx * 0.011 + 91.4, wz * 0.011 + 13.2, seed ^ 0x1234, 3));
      let dirtW = Math.max(shore, patch * 0.85) * (1 - rockW);
      let adjustedRockW = rockW;
      if (kind === 'crater-oasis') {
        const r = Math.hypot(wx, wz);
        const angle = Math.atan2(wz, wx);
        const craterDust = smoothstep(size * 0.42, size * 0.12, r);
        const rim = smoothstep(size * 0.14, size * 0.22, r) * smoothstep(size * 0.36, size * 0.27, r);
        const diagonalScars = smoothstep(0.16, 0.025, Math.abs(Math.cos(angle * 2))) * smoothstep(size * 0.46, size * 0.08, r);
        adjustedRockW = Math.max(adjustedRockW, rim * 0.62);
        dirtW = Math.max(dirtW, craterDust * 0.42, diagonalScars * 0.72);
      } else if (kind === 'frostbite-pass') {
        const ridgeIce = smoothstep(0.34, 0.72, slope);
        const windScrape = smoothstep(0.58, 0.74, fbm2(wx * 0.018 - 28.4, wz * 0.018 + 44.9, seed ^ 0xf051, 3));
        const passIce = smoothstep(size * 0.15, size * 0.035, Math.abs(wz + Math.sin(wx * 0.006) * 38));
        adjustedRockW = Math.max(adjustedRockW, ridgeIce * 0.72);
        dirtW = Math.max(dirtW, windScrape * 0.34, passIce * 0.58);
      }
      dirtW *= 1 - adjustedRockW;
      let oreW = 0;
      for (const f of oreFields) {
        const d = Math.hypot(wx - f.x, wz - f.z);
        oreW = Math.max(oreW, smoothstep(f.radius, f.radius * 0.5, d));
      }
      oreW *= 1 - adjustedRockW;
      dirtW *= 1 - oreW;
      const grassW = Math.max(0, 1 - adjustedRockW - dirtW - oreW);
      const sum = grassW + dirtW + adjustedRockW + oreW;
      splat[i * 4] = Math.round((grassW / sum) * 255);
      splat[i * 4 + 1] = Math.round((dirtW / sum) * 255);
      splat[i * 4 + 2] = Math.round((adjustedRockW / sum) * 255);
      splat[i * 4 + 3] = Math.round((oreW / sum) * 255);
    }
  }

  // --- walkability: true cliff edges and water block movement ---
  // Use the four physical cell edges rather than the full corner range. The old
  // min/max comparison treated a smooth diagonal hillside as a cliff because it
  // added the rise across both axes.
  const walkable = new Uint8Array(cells * cells);
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const i00 = cy * samples + cx;
      const h00 = heights[i00];
      const h10 = heights[i00 + 1];
      const h01 = heights[i00 + samples];
      const h11 = heights[i00 + samples + 1];
      const center = (h00 + h10 + h01 + h11) / 4;
      const maxEdgeRise = Math.max(
        Math.abs(h10 - h00),
        Math.abs(h01 - h00),
        Math.abs(h11 - h10),
        Math.abs(h11 - h01),
      );
      const blocked = maxEdgeRise > cellSize * MAX_WALKABLE_EDGE_GRADE || center < waterLevel + 0.25;
      walkable[cy * cells + cx] = blocked ? 0 : 1;
    }
  }

  return { kind, cells, cellSize, size, samples, waterLevel, maxHeight, heights, walkable, splat, oreFields };
}

function flattenDeploymentShelves(heights: Float32Array, samples: number, cellSize: number, size: number): void {
  const half = size / 2;
  const innerRadius = Math.max(36, size * 0.045);
  const outerRadius = Math.max(70, size * 0.085);
  for (const [fx, fz] of [[-0.34, -0.34], [0.34, 0.34], [0.34, -0.34], [-0.34, 0.34]] as const) {
    const centerX = size * fx;
    const centerZ = size * fz;
    const target = sampleHeightData(heights, samples, cellSize, centerX, centerZ);
    const minX = Math.max(0, Math.floor((centerX - outerRadius + half) / cellSize));
    const maxX = Math.min(samples - 1, Math.ceil((centerX + outerRadius + half) / cellSize));
    const minZ = Math.max(0, Math.floor((centerZ - outerRadius + half) / cellSize));
    const maxZ = Math.min(samples - 1, Math.ceil((centerZ + outerRadius + half) / cellSize));
    for (let gz = minZ; gz <= maxZ; gz++) {
      const wz = gz * cellSize - half;
      for (let gx = minX; gx <= maxX; gx++) {
        const wx = gx * cellSize - half;
        const distance = Math.hypot(wx - centerX, wz - centerZ);
        if (distance >= outerRadius) continue;
        const blend = smoothstep(outerRadius, innerRadius, distance);
        const index = gz * samples + gx;
        heights[index] += (target - heights[index]) * blend;
      }
    }
  }
}

function oreRadius(kind: MapConfig['kind'], rng: () => number): number {
  if (kind === 'crater-oasis') return 30 + rng() * 18;
  if (kind === 'frostbite-pass') return 28 + rng() * 16;
  return 26 + rng() * 14;
}

function findOreSpotNear(
  heights: Float32Array,
  samples: number,
  cellSize: number,
  size: number,
  waterLevel: number,
  anchorX: number,
  anchorZ: number,
  rng: () => number,
  existing: OreField[],
  minSpacing: number,
  kind: MapKind,
): OreField | undefined {
  for (let attempt = 0; attempt < 44; attempt++) {
    const radius = (rng() ** 0.7) * size * 0.075;
    const angle = rng() * Math.PI * 2;
    const x = Math.max(-size * 0.44, Math.min(size * 0.44, anchorX + Math.cos(angle) * radius));
    const z = Math.max(-size * 0.44, Math.min(size * 0.44, anchorZ + Math.sin(angle) * radius));
    const h = sampleHeightData(heights, samples, cellSize, x, z);
    if (h < waterLevel + 1.4) continue;
    const sx = Math.abs(sampleHeightData(heights, samples, cellSize, x + 4, z) - sampleHeightData(heights, samples, cellSize, x - 4, z)) / 8;
    const sz = Math.abs(sampleHeightData(heights, samples, cellSize, x, z + 4) - sampleHeightData(heights, samples, cellSize, x, z - 4)) / 8;
    if (Math.max(sx, sz) > 0.38) continue;
    if (existing.some((field) => (field.x - x) ** 2 + (field.z - z) ** 2 < minSpacing ** 2)) continue;
    return { x, z, radius: oreRadius(kind, rng) };
  }
  return undefined;
}

/** FNV-1a over all generated data — used by determinism tests. */
export function hashHeightfield(hf: Heightfield): number {
  let h = 0x811c9dc5 >>> 0;
  const mix = (v: number) => {
    h = Math.imul(h ^ v, 0x01000193) >>> 0;
  };
  const hu = new Uint32Array(hf.heights.buffer, hf.heights.byteOffset, hf.heights.length);
  for (let i = 0; i < hu.length; i++) mix(hu[i]);
  for (let i = 0; i < hf.walkable.length; i++) mix(hf.walkable[i]);
  for (let i = 0; i < hf.splat.length; i++) mix(hf.splat[i]);
  return h >>> 0;
}
