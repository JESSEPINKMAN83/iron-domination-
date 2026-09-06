import { describe, expect, it } from 'vitest';
import { MAP_IDS, mapConfig } from '../content/maps';
import { generateHeightfield, hashHeightfield, oreFieldCapacity, sampleHeight, type Heightfield, type TerrainLayout } from './heightfield';
import { createTacticalMapRaster } from '../ui/tacticalMap';
import { createGameSim } from './world';

function connectedStarts(hf: Heightfield): boolean {
  const cell = (x: number, z: number) => Math.floor((z + .5) * hf.cells) * hf.cells + Math.floor((x + .5) * hf.cells);
  const starts = [cell(-.34, -.34), cell(.34, .34), cell(-.34, .34), cell(.34, -.34)];
  const seen = new Uint8Array(hf.cells * hf.cells);
  const queue = [starts[0]];
  seen[starts[0]] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const at = queue[cursor], x = at % hf.cells;
    for (const next of [x > 0 ? at - 1 : -1, x < hf.cells - 1 ? at + 1 : -1, at - hf.cells, at + hf.cells]) {
      if (next < 0 || next >= seen.length || seen[next] || !hf.walkable[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return starts.every(index => !!hf.walkable[index] && !!seen[index]);
}

describe('setup terrain layouts', () => {
  for (const mapId of MAP_IDS) {
    it(`${mapId}: lakes stay submerged and hills visibly differ from plains`, () => {
      for (const seed of [1337, 2222, 619337]) {
        const make = (layout: TerrainLayout) => generateHeightfield({ ...mapConfig(mapId, 'small', 100, undefined, layout), seed });
        const lakes = make('lakes');
        const hills = make('hills');
        const plains = make('plains');
        const waterFraction = lakes.heights.filter(h => h < lakes.waterLevel).length / lakes.heights.length;
        expect(waterFraction, `seed ${seed}: visible lakes`).toBeGreaterThan(0.06);
        expect(waterFraction).toBeLessThan(0.35);
        const percentile95 = (hf: Heightfield) => hf.heights.slice().sort()[Math.floor(hf.heights.length * 0.95)];
        expect(percentile95(hills) - percentile95(plains), `seed ${seed}: broad hills`).toBeGreaterThan(18);
        expect(connectedStarts(lakes)).toBe(true);
        expect(connectedStarts(hills)).toBe(true);
      }
    });
    it(`${mapId}: distinct seeded layouts with connected, dry starting areas`, () => {
      const hashes = new Set<number>();
      for (const terrainLayout of ['plains', 'hills', 'lakes'] as TerrainLayout[]) {
        for (const seed of [1337, 619337]) {
          const config = { ...mapConfig(mapId, 'small', 100, 150, terrainLayout), seed };
          const hf = generateHeightfield(config);
          hashes.add(hashHeightfield(hf));
          expect(connectedStarts(hf), `${terrainLayout}, seed ${seed}`).toBe(true);
          expect(sampleHeight(hf, -.34 * hf.size, -.34 * hf.size)).toBeGreaterThan(hf.waterLevel);
          expect(hf.heights.length).toBe((config.cells + 1) ** 2);
        }
      }
      expect(hashes.size).toBe(6);
    });
    it(`${mapId}: rich ore increases supplies without increasing fields, and preview matches the game`, () => {
      const baseConfig = mapConfig(mapId, 'small', 200, 100, 'lakes');
      const richConfig = mapConfig(mapId, 'small', 400, 100, 'lakes');
      const base = generateHeightfield(baseConfig);
      const rich = generateHeightfield(richConfig);
      expect(rich.oreFields.map(f => [f.x, f.z, f.radius])).toEqual(base.oreFields.map(f => [f.x, f.z, f.radius]));
      const total = (hf: Heightfield) => hf.oreFields.reduce((sum, f) => sum + oreFieldCapacity(f), 0);
      expect(total(rich)).toBeCloseTo(total(base) * 2, -2);
      const raster = createTacticalMapRaster(mapId, 'small', richConfig.seed, 48, 400, 100, 'lakes');
      expect(raster.oreFields).toEqual(rich.oreFields);
      expect(createGameSim(rich).resourceNodes.reduce((sum, n) => sum + n.capacity, 0)).toBe(total(rich));
    });
  }
});
