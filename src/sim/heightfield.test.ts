import { describe, expect, it } from 'vitest';
import { MAP_PRESETS } from '../content/maps';
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

  it('generates a distinct crater oasis map with central water and contested oil', () => {
    const seed = 240771;
    const highlands = generateHeightfield({ ...MAP_PRESETS.highlands.config, seed });
    const crater = generateHeightfield({ ...MAP_PRESETS['crater-oasis'].config, seed });

    expect(hashHeightfield(crater)).not.toBe(hashHeightfield(highlands));
    expect(crater.oreFields.length).toBe(8);
    expect(crater.oreFields.length).toBeGreaterThan(highlands.oreFields.length);
    expect(crater.heights[Math.floor(crater.samples / 2) * crater.samples + Math.floor(crater.samples / 2)]).toBeLessThan(crater.waterLevel);

    const rimSamples = crater.oreFields.filter((field) => Math.hypot(field.x, field.z) < crater.size * 0.42);
    expect(rimSamples.length).toBeGreaterThanOrEqual(4);
  });

  it('generates a distinct frostbite pass map with icy choke routes and exposed ore', () => {
    const seed = 771204;
    const highlands = generateHeightfield({ ...MAP_PRESETS.highlands.config, seed });
    const frost = generateHeightfield({ ...MAP_PRESETS['frostbite-pass'].config, seed });

    expect(hashHeightfield(frost)).not.toBe(hashHeightfield(highlands));
    expect(frost.kind).toBe('frostbite-pass');
    expect(frost.oreFields.length).toBe(7);

    const center = frost.heights[Math.floor(frost.samples / 2) * frost.samples + Math.floor(frost.samples / 2)];
    expect(center).toBeLessThan(frost.waterLevel + 2.5);

    const passOre = frost.oreFields.filter((field) => Math.abs(field.z) < frost.size * 0.38);
    expect(passOre.length).toBeGreaterThanOrEqual(4);
  });
});
