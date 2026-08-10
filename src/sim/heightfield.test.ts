import { describe, expect, it } from 'vitest';
import { MAP_PRESETS, mapConfig, sanitizeOreAmount, sanitizeTerrainRelief } from '../content/maps';
import { generateHeightfield, hasTerrainLineOfSight, hashHeightfield, sampleHeight, type Heightfield, type MapConfig } from './heightfield';

const cfg: MapConfig = { seed: 1337, cells: 128, cellSize: 2, waterLevel: 2, oreFieldCount: 3 };
const phase1MapCfg: MapConfig = { seed: 1337, cells: 512, cellSize: 2, waterLevel: 2, oreFieldCount: 5 };

describe('heightfield generation', () => {
  it('scales terrain and ore fields across setup map sizes while preserving the medium default', () => {
    const small = mapConfig('highlands', 'small');
    const medium = mapConfig('highlands', 'medium');
    const large = mapConfig('highlands', 'large');

    expect(small).toMatchObject({ cells: 384, cellSize: 2, oreFieldCount: 4 });
    expect(medium).toEqual(MAP_PRESETS.highlands.config);
    expect(large).toMatchObject({ cells: 640, cellSize: 2, oreFieldCount: 6 });
  });

  it('scales ore field count with the bounded setup ore amount', () => {
    expect(mapConfig('highlands', 'small', 50).oreFieldCount).toBe(2);
    expect(mapConfig('highlands', 'medium', 100).oreFieldCount).toBe(5);
    expect(mapConfig('highlands', 'large', 200).oreFieldCount).toBe(13);
    expect(sanitizeOreAmount(null)).toBeUndefined();
    expect(sanitizeOreAmount(37)).toBe(50);
    expect(sanitizeOreAmount(164)).toBe(175);
    expect(sanitizeOreAmount(999)).toBe(200);
  });

  it('bounds terrain relief and gives the desert a deep tactical default', () => {
    expect(sanitizeTerrainRelief(null)).toBeUndefined();
    expect(sanitizeTerrainRelief(31)).toBe(50);
    expect(sanitizeTerrainRelief(117)).toBe(125);
    expect(sanitizeTerrainRelief(999)).toBe(150);
    expect(mapConfig('highlands').terrainRelief).toBe(75);
    expect(mapConfig('crater-oasis').terrainRelief).toBe(125);
  });

  it('scales deterministic canyon depth while keeping every deployment shelf flat', () => {
    const seed = 240771;
    const gentle = generateHeightfield({ ...mapConfig('crater-oasis', 'medium', 100, 50), seed });
    const extreme = generateHeightfield({ ...mapConfig('crater-oasis', 'medium', 100, 150), seed });
    const range = (hf: typeof gentle): number => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const height of hf.heights) {
        min = Math.min(min, height);
        max = Math.max(max, height);
      }
      return max - min;
    };
    expect(range(extreme)).toBeGreaterThan(range(gentle) * 2.4);
    expect(hashHeightfield(extreme)).not.toBe(hashHeightfield(gentle));

    for (const [fx, fz] of [[-0.34, -0.34], [0.34, 0.34], [0.34, -0.34], [-0.34, 0.34]] as const) {
      const x = extreme.size * fx;
      const z = extreme.size * fz;
      const center = sampleHeight(extreme, x, z);
      for (const [dx, dz] of [[24, 0], [-24, 0], [0, 24], [0, -24]] as const) {
        expect(sampleHeight(extreme, x + dx, z + dz)).toBeCloseTo(center, 3);
      }
      expect(center).toBeGreaterThan(extreme.waterLevel + 0.5);
    }
  });

  it('keeps high-relief mountains broad and mostly climbable instead of creating thin cliff seams', () => {
    for (const mapId of ['highlands', 'crater-oasis', 'frostbite-pass'] as const) {
      const hf = generateHeightfield({ ...mapConfig(mapId, 'medium', 100, 150), seed: 619337 });
      const dryEdgeRises: number[] = [];
      let dryCells = 0;
      let walkableDryCells = 0;
      for (let cy = 0; cy < hf.cells; cy++) {
        for (let cx = 0; cx < hf.cells; cx++) {
          const i00 = cy * hf.samples + cx;
          const h00 = hf.heights[i00];
          const h10 = hf.heights[i00 + 1];
          const h01 = hf.heights[i00 + hf.samples];
          const h11 = hf.heights[i00 + hf.samples + 1];
          const center = (h00 + h10 + h01 + h11) / 4;
          if (center < hf.waterLevel + 0.25) continue;
          dryCells++;
          if (hf.walkable[cy * hf.cells + cx] !== 0) walkableDryCells++;
          dryEdgeRises.push(Math.max(
            Math.abs(h10 - h00),
            Math.abs(h01 - h00),
            Math.abs(h11 - h10),
            Math.abs(h11 - h01),
          ));
        }
      }
      dryEdgeRises.sort((a, b) => a - b);
      const p99EdgeRise = dryEdgeRises[Math.floor((dryEdgeRises.length - 1) * 0.99)];
      expect(walkableDryCells / dryCells, `${mapId} dry walkability`).toBeGreaterThan(0.95);
      expect(p99EdgeRise, `${mapId} 99th-percentile edge rise`).toBeLessThan(hf.cellSize * 1.3);
    }
  });

  it('uses ridgelines as direct-fire cover while allowing fire over them', () => {
    const samples = 9;
    const cells = samples - 1;
    const heights = new Float32Array(samples * samples);
    for (let z = 0; z < samples; z++) {
      for (let x = 0; x < samples; x++) {
        if (x >= 3 && x <= 5) heights[z * samples + x] = 8;
      }
    }
    const ridge: Heightfield = {
      kind: 'highlands',
      cells,
      cellSize: 2,
      size: cells * 2,
      samples,
      waterLevel: -2,
      maxHeight: 8,
      heights,
      walkable: new Uint8Array(cells * cells).fill(1),
      splat: new Uint8Array(cells * cells * 4),
      oreFields: [],
    };

    expect(hasTerrainLineOfSight(ridge, -7, 2, 0, 7, 2, 0)).toBe(false);
    expect(hasTerrainLineOfSight(ridge, -7, 12, 0, 7, 12, 0)).toBe(true);
  });

  it('generates every requested ore field at maximum abundance', () => {
    for (const mapId of ['highlands', 'crater-oasis', 'frostbite-pass'] as const) {
      const config = mapConfig(mapId, 'large', 200);
      const hf = generateHeightfield({ ...config, seed: 883122 });
      expect(hf.oreFields).toHaveLength(config.oreFieldCount);
    }
  });

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

  it('does not invent cliff barriers across a compact dry battlefield', () => {
    const hf = generateHeightfield(cfg);
    let walkableCount = 0;
    for (let i = 0; i < hf.walkable.length; i++) walkableCount += hf.walkable[i];
    expect(walkableCount).toBe(hf.walkable.length);
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
