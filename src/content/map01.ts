import type { MapConfig } from '../sim/heightfield';

// 512×512 cells × 2 m = 1024 m per side ≈ 1 km².
export const MAP01: MapConfig = {
  seed: 1337,
  cells: 512,
  cellSize: 2,
  waterLevel: 2.0,
  oreFieldCount: 5,
};
