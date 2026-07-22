import { describe, expect, it } from 'vitest';
import { createTacticalMapRaster, worldToMapPercent } from './tacticalMap';

describe('tactical map', () => {
  it('uses the exact selected battlefield dimensions and generated features', () => {
    const raster = createTacticalMapRaster('highlands', 'small', 1337, 48);

    expect(raster.worldSize).toBe(768);
    expect(raster.width).toBe(48);
    expect(raster.height).toBe(48);
    expect(raster.pixels).toHaveLength(48 * 48 * 4);
    expect(raster.oreFields).toHaveLength(4);
    expect(raster.maxHeight).toBeGreaterThan(raster.waterLevel);
    expect(raster.waterCoverage).toBeGreaterThanOrEqual(0);
    expect(raster.waterCoverage).toBeLessThan(1);
  });

  it('maps world corners and centre without changing the square proportions', () => {
    expect(worldToMapPercent(1000, -500, -500)).toEqual({ x: 0, y: 0 });
    expect(worldToMapPercent(1000, 0, 0)).toEqual({ x: 50, y: 50 });
    expect(worldToMapPercent(1000, 500, 500)).toEqual({ x: 100, y: 100 });
  });
});
