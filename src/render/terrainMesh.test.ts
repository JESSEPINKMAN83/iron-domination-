import { describe, expect, it } from 'vitest';
import { MAP_PRESETS } from '../content/maps';
import { generateHeightfield, sampleHeight } from '../sim/heightfield';
import { createTerrainDiscGeometry } from './terrainMesh';

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
