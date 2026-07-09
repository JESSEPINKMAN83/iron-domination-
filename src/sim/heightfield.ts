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

function terrace(n: number, steps: number, blend: number): number {
  const s = n * steps;
  const base = Math.floor(s);
  const f = s - base;
  return (base + smoothstep(0.5 - blend, 0.5 + blend, f)) / steps;
}

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

export function generateHeightfield(cfg: MapConfig): Heightfield {
  const { seed, cells, cellSize, waterLevel } = cfg;
  const kind = cfg.kind ?? 'highlands';
  const samples = cells + 1;
  const size = cells * cellSize;
  const half = size / 2;

  // --- heights: rolling continent + terraced plateaus (cliffs) + detail, basins for lakes ---
  const heights = new Float32Array(samples * samples);
  let maxHeight = 0;
  for (let gy = 0; gy < samples; gy++) {
    for (let gx = 0; gx < samples; gx++) {
      const wx = gx * cellSize - half;
      const wz = gy * cellSize - half;
      const continent = fbm2(wx * 0.0011 + 3.7, wz * 0.0011 - 8.2, seed, 4);
      const plate = fbm2(wx * 0.0019 + 41.3, wz * 0.0019 + 17.9, seed ^ 0x51bd, 3);
      const mask = smoothstep(0.34, 0.62, continent);
      const rolling = (fbm2(wx * 0.016, wz * 0.016, seed ^ 0x9e37, 4) - 0.5) * 3.0;
      const basin = smoothstep(0.4, 0.22, continent);
      const noisyLake = smoothstep(0.3, 0.16, fbm2(wx * 0.0031 - 19.7, wz * 0.0031 + 73.4, seed ^ 0xa17e, 3));
      const basinA = smoothstep(size * 0.16, size * 0.07, Math.hypot(wx + size * 0.24, wz - size * 0.16));
      const basinB = smoothstep(size * 0.12, size * 0.05, Math.hypot(wx - size * 0.18, wz + size * 0.22));
      const lakePocket = Math.max(noisyLake, basinA, basinB);
      let h =
        4.0 +
        continent * 8.0 +
        terrace(plate, 4, 0.02) * 34.0 * mask +
        rolling -
        basin * 18.0 -
        lakePocket * 9.0;
      if (kind === 'crater-oasis') {
        const r = Math.hypot(wx, wz);
        const angle = Math.atan2(wz, wx);
        const crater = smoothstep(size * 0.19, size * 0.045, r);
        const innerRim = smoothstep(size * 0.12, size * 0.2, r);
        const outerRim = smoothstep(size * 0.34, size * 0.25, r);
        const diagonalGates = smoothstep(0.2, 0.035, Math.abs(Math.cos(angle * 2)));
        const brokenRim = innerRim * outerRim * (1 - diagonalGates * 0.72);
        const outerPlateau = smoothstep(size * 0.42, size * 0.22, r);
        h += brokenRim * 23.0 - crater * 24.0 + outerPlateau * 4.0;
      } else if (kind === 'frostbite-pass') {
        const ridgeA = smoothstep(90, 10, Math.abs(wx + size * 0.23 + Math.sin(wz * 0.009) * 42));
        const ridgeB = smoothstep(82, 12, Math.abs(wx - size * 0.25 + Math.sin(wz * 0.008 + 1.7) * 38));
        const pass = smoothstep(size * 0.11, size * 0.028, Math.abs(wz + Math.sin(wx * 0.006) * 38));
        const frozenBasin = smoothstep(size * 0.19, size * 0.05, Math.hypot(wx, wz - size * 0.04));
        const northShelf = smoothstep(size * 0.46, size * 0.18, Math.abs(wz - size * 0.3));
        h += ridgeA * 26.0 + ridgeB * 24.0 + northShelf * 6.0 - pass * 16.0 - frozenBasin * 18.0;
      }
      heights[gy * samples + gx] = h;
      if (h > maxHeight) maxHeight = h;
    }
  }

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

  // --- walkability: cliffs (large rise within a cell) and water block movement ---
  const walkable = new Uint8Array(cells * cells);
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const i00 = cy * samples + cx;
      const h00 = heights[i00];
      const h10 = heights[i00 + 1];
      const h01 = heights[i00 + samples];
      const h11 = heights[i00 + samples + 1];
      const hMin = Math.min(h00, h10, h01, h11);
      const hMax = Math.max(h00, h10, h01, h11);
      const center = (h00 + h10 + h01 + h11) / 4;
      const blocked = hMax - hMin > cellSize * 0.85 || center < waterLevel + 0.25;
      walkable[cy * cells + cx] = blocked ? 0 : 1;
    }
  }

  return { kind, cells, cellSize, size, samples, waterLevel, maxHeight, heights, walkable, splat, oreFields };
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
