import { describe, expect, it } from 'vitest';
import { generateHeightfield, hashHeightfield, type MapConfig } from './heightfield';

const cfg: MapConfig = { seed: 1337, cells: 128, cellSize: 2, waterLevel: 2, oreFieldCount: 3 };
const phase1MapCfg: MapConfig = { seed: 1337, cells: 512, cellSize: 2, waterLevel: 2, oreFieldCount: 5 };

describe('heightfield generation', () => {
  it('is deterministic: same seed → identical data hash', () => {
    const a = hashHeightfield(generateHeightfield(cfg));
    const b = hashHeightfield(generateHeightfield({ ...cfg }));
    expect(a).toBe(b);
  });

  it('different seed → different terrain', () => {
    const a = hashHeightfield(generateHeightfield(cfg));
    const b = hashHeightfield(generateHeightfield({ ...cfg, seed: 42 }));
    expect(a).not.toBe(b);
  });

  it('produces both walkable and blocked cells (cliffs/water block movement)', () => {
    const hf = generateHeightfield(cfg);
    let walkableCount = 0;
    for (let i = 0; i < hf.walkable.length; i++) walkableCount += hf.walkable[i];
    expect(walkableCount).toBeGreaterThan(0);
    expect(walkableCount).toBeLessThan(hf.walkable.length);
  });

  it('places visible water basins that block movement', () => {
    const hf = generateHeightfield(phase1MapCfg);
    let belowWaterSamples = 0;
    let blockedWaterCells = 0;
    for (let i = 0; i < hf.heights.length; i++) {
      if (hf.heights[i] < hf.waterLevel) belowWaterSamples++;
    }
    for (let cy = 0; cy < hf.cells; cy++) {
      for (let cx = 0; cx < hf.cells; cx++) {
        const i00 = cy * hf.samples + cx;
        const center =
          (hf.heights[i00] + hf.heights[i00 + 1] + hf.heights[i00 + hf.samples] + hf.heights[i00 + hf.samples + 1]) /
          4;
        if (center < hf.waterLevel + 0.25 && hf.walkable[cy * hf.cells + cx] === 0) blockedWaterCells++;
      }
    }
    expect(belowWaterSamples).toBeGreaterThan(0);
    expect(blockedWaterCells).toBeGreaterThan(0);
  });

  it('heights are finite and ore fields are placed', () => {
    const hf = generateHeightfield(cfg);
    for (let i = 0; i < hf.heights.length; i++) {
      expect(Number.isFinite(hf.heights[i])).toBe(true);
    }
    expect(hf.oreFields.length).toBeGreaterThan(0);
  });
});
