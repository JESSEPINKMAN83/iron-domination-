import {generateHeightfield} from '../sim/heightfield';
import {mapConfig} from '../content/maps';
import { describe, expect, it } from 'vitest';
import { createTacticalMapRaster, tacticalMapRasterForHeightfield, worldToMapPercent } from './tacticalMap';

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

  it('shows the selected ore amount in the generated tactical survey', () => {
    const sparse = createTacticalMapRaster('highlands', 'medium', 1337, 48, 50);
    const abundant = createTacticalMapRaster('highlands', 'medium', 1337, 48, 200);

    expect(sparse.oreFields).toHaveLength(3);
    expect(abundant.oreFields).toHaveLength(25);
  });

  it('renders the selected terrain relief in the tactical survey', () => {
    const gentle = createTacticalMapRaster('crater-oasis', 'medium', 240771, 48, 100, 50);
    const extreme = createTacticalMapRaster('crater-oasis', 'medium', 240771, 48, 100, 150);

    expect(extreme.maxHeight).toBeGreaterThan(gentle.maxHeight * 2);
    expect(Array.from(extreme.pixels)).not.toEqual(Array.from(gentle.pixels));
  });
});

it('reuses the live match terrain raster without regenerating or mutating terrain',()=>{
 const hf=generateHeightfield({...mapConfig('highlands','small'),seed:41});
 const before=hf.heights.slice();
 const raster=tacticalMapRasterForHeightfield('highlands',hf,48);
 expect(tacticalMapRasterForHeightfield('highlands',hf,48)).toBe(raster);
 expect(raster.pixels).toEqual(createTacticalMapRaster('highlands','small',41,48).pixels);
 expect(hf.heights).toEqual(before);
 expect(tacticalMapRasterForHeightfield('highlands',hf,64)).not.toBe(raster);
});
