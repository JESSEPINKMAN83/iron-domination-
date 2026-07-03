// Terrain data generation: heights, walkability, splat weights, ore fields.
// Fully deterministic from the map seed. No rendering dependencies.
import { fbm2, mulberry32, smoothstep } from './noise';

export interface MapConfig {
  seed: number;
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
  /** samples×samples RGBA: R=grass G=dirt B=rock A=ore */
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
      const h =
        4.0 +
        continent * 8.0 +
        terrace(plate, 4, 0.02) * 34.0 * mask +
        rolling -
        basin * 18.0 -
        lakePocket * 9.0;
      heights[gy * samples + gx] = h;
      if (h > maxHeight) maxHeight = h;
    }
  }

  // --- ore fields: flat, dry, mutually spaced spots ---
  const rng = mulberry32(seed ^ 0x0be5);
  const oreFields: OreField[] = [];
  const minSpacing = Math.min(150, size * 0.3);
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
    oreFields.push({ x, z, radius: 26 + rng() * 14 });
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
      let oreW = 0;
      for (const f of oreFields) {
        const d = Math.hypot(wx - f.x, wz - f.z);
        oreW = Math.max(oreW, smoothstep(f.radius, f.radius * 0.5, d));
      }
      oreW *= 1 - rockW;
      dirtW *= 1 - oreW;
      const grassW = Math.max(0, 1 - rockW - dirtW - oreW);
      const sum = grassW + dirtW + rockW + oreW;
      splat[i * 4] = Math.round((grassW / sum) * 255);
      splat[i * 4 + 1] = Math.round((dirtW / sum) * 255);
      splat[i * 4 + 2] = Math.round((rockW / sum) * 255);
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

  return { cells, cellSize, size, samples, waterLevel, maxHeight, heights, walkable, splat, oreFields };
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
