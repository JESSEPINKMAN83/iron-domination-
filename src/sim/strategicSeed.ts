import { mapConfig, type MapId, type MapSize } from '../content/maps';
import { generateHeightfield } from './heightfield';

export interface StrategicSeedOptions {
  mapId: MapId;
  mapSize: MapSize;
  oreAmount: number;
  terrainRelief: number;
}

const SCOUTING_CELLS = 128;

/**
 * Selects the most tactically varied map from a small set of random candidates.
 * Evaluation uses a coarse heightfield with the exact same world dimensions,
 * keeping setup responsive while preserving the large-scale terrain features.
 */
export function chooseStrategicSeed(options: StrategicSeedOptions, candidates: readonly number[]): number {
  if (candidates.length === 0) throw new Error('At least one map seed candidate is required.');
  let bestSeed = normalizeSeed(candidates[0]);
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const seed = normalizeSeed(candidate);
    const score = strategicSeedScore(options, seed);
    if (score > bestScore) {
      bestSeed = seed;
      bestScore = score;
    }
  }
  return bestSeed;
}

export function strategicSeedScore(options: StrategicSeedOptions, seed: number): number {
  const full = mapConfig(options.mapId, options.mapSize, options.oreAmount, options.terrainRelief);
  const worldSize = full.cells * full.cellSize;
  const hf = generateHeightfield({
    ...full,
    seed: normalizeSeed(seed),
    cells: SCOUTING_CELLS,
    cellSize: worldSize / SCOUTING_CELLS,
  });

  const dryHeights: number[] = [];
  let dryCells = 0;
  let walkableDryCells = 0;
  for (let z = 0; z < hf.cells; z++) {
    for (let x = 0; x < hf.cells; x++) {
      const sampleIndex = z * hf.samples + x;
      const height = hf.heights[sampleIndex];
      if (height <= hf.waterLevel + 0.25) continue;
      dryCells++;
      walkableDryCells += hf.walkable[z * hf.cells + x];
      dryHeights.push(height);
    }
  }
  dryHeights.sort((a, b) => a - b);
  const p10 = percentile(dryHeights, 0.1);
  const p90 = percentile(dryHeights, 0.9);
  const reliefRange = Math.min(1, (p90 - p10) / Math.max(8, hf.maxHeight - hf.waterLevel));
  const walkability = dryCells > 0 ? walkableDryCells / dryCells : 0;
  const waterCoverage = 1 - dryCells / (hf.cells * hf.cells);
  const waterTarget = options.mapId === 'crater-oasis' ? 0.055 : options.mapId === 'frostbite-pass' ? 0.12 : 0.1;
  const waterInterest = 1 - Math.min(1, Math.abs(waterCoverage - waterTarget) / 0.2);

  const oreCount = Math.max(1, hf.oreFields.length);
  const occupiedQuadrants = new Set(hf.oreFields.map((field) => `${field.x >= 0 ? 1 : 0}:${field.z >= 0 ? 1 : 0}`)).size / 4;
  const contestedOre = hf.oreFields.filter((field) => Math.hypot(field.x, field.z) < hf.size * 0.27).length / oreCount;
  const expansionOre = hf.oreFields.filter((field) => Math.hypot(field.x, field.z) >= hf.size * 0.27).length / oreCount;
  const resourceMix = Math.min(1, contestedOre * 1.8) * 0.55 + Math.min(1, expansionOre * 1.35) * 0.45;
  const accessBalance = oreAccessBalance(hf.size, hf.oreFields);

  return reliefRange * 2.2
    + walkability * 1.8
    + waterInterest * 1.25
    + occupiedQuadrants * 1.5
    + resourceMix * 1.4
    + accessBalance * 1.65;
}

function oreAccessBalance(size: number, fields: readonly { x: number; z: number }[]): number {
  if (fields.length === 0) return 0;
  const starts = [
    [-0.34, -0.34],
    [0.34, 0.34],
    [0.34, -0.34],
    [-0.34, 0.34],
  ] as const;
  const nearest = starts.map(([fx, fz]) => {
    const x = fx * size;
    const z = fz * size;
    return Math.min(...fields.map((field) => Math.hypot(field.x - x, field.z - z)));
  });
  const spread = Math.max(...nearest) - Math.min(...nearest);
  return 1 - Math.min(1, spread / (size * 0.24));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function normalizeSeed(seed: number): number {
  return Math.max(1, Math.floor(Number(seed) || 1));
}
