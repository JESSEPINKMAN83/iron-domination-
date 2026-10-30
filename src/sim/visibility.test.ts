import { describe, expect, it } from 'vitest';
import { generateHeightfield } from './heightfield';
import { VisibilityGrid } from './visibility';

describe('VisibilityGrid disc stamping', () => {
  it('marks exactly the cells whose centres fall inside the disc, including map edges', () => {
    const hf = generateHeightfield({ cells: 64, cellSize: 4, seed: 3, waterLevel: -100, oreFieldCount: 0 });
    const grid = new VisibilityGrid(hf, 1);
    const stamp = (grid as unknown as { stampDisc(x: number, z: number, r: number, t: Uint8Array): void }).stampDisc.bind(grid);
    const half = hf.size / 2;
    let seed = 99;
    const next = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 300; i++) {
      const x = (next() - 0.5) * hf.size * 1.2;
      const z = (next() - 0.5) * hf.size * 1.2;
      const radius = i % 10 === 0 ? grid.cellSize * (0.3 + next()) : 8 + next() * 90;
      const actual = new Uint8Array(grid.res * grid.res);
      stamp(x, z, radius, actual);
      const expected = new Uint8Array(grid.res * grid.res);
      for (let cz = 0; cz < grid.res; cz++) {
        for (let cx = 0; cx < grid.res; cx++) {
          const wx = (cx + 0.5) * grid.cellSize - half;
          const wz = (cz + 0.5) * grid.cellSize - half;
          if ((wx - x) ** 2 + (wz - z) ** 2 <= radius * radius) expected[cz * grid.res + cx] = 2;
        }
      }
      expect(actual).toEqual(expected);
    }
  });
});
