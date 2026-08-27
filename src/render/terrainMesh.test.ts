import { describe, expect, it } from 'vitest';
import { MAP_PRESETS } from '../content/maps';
import { generateHeightfield, sampleHeight } from '../sim/heightfield';
import { createTerrainDiscGeometry, createTerrainSkirtGeometry } from './terrainMesh';

describe('terrain-conforming resource fields', () => {
  it('drapes every marker vertex over the terrain instead of using one flat height', () => {
    const hf = generateHeightfield({ ...MAP_PRESETS.highlands.config, seed: 191284831 });
    const field = hf.oreFields[0];
    const lift = 0.18;
    const geometry = createTerrainDiscGeometry(hf, field.x, field.z, field.radius * 1.28, 48, lift);
    const positions = geometry.getAttribute('position');

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      expect(y).toBeCloseTo(sampleHeight(hf, x, z) + lift, 4);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    expect(maxY - minY).toBeGreaterThan(0.1);
    geometry.dispose();
  });
});

describe('terrain edge thickness', () => {
  it('adds a continuous skirt below every map edge', () => {
    const hf = generateHeightfield({ ...MAP_PRESETS['frostbite-pass'].config, seed: 42 });
    const thickness = 14;
    const geometry = createTerrainSkirtGeometry(hf, thickness);
    const positions = geometry.getAttribute('position');
    const expectedVertices = hf.samples * 4 * 2;

    expect(positions.count).toBe(expectedVertices);
    expect(geometry.index?.count).toBe((hf.samples - 1) * 4 * 6);

    let minTop = Number.POSITIVE_INFINITY;
    let minBottom = Number.POSITIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < positions.count; index += 2) {
      minTop = Math.min(minTop, positions.getY(index));
      minBottom = Math.min(minBottom, positions.getY(index + 1));
      maxBottom = Math.max(maxBottom, positions.getY(index + 1));
    }
    expect(maxBottom).toBeCloseTo(minBottom, 5);
    expect(minTop - minBottom).toBeCloseTo(thickness, 4);
    geometry.dispose();
  });
});
