import { describe, expect, it } from 'vitest';
import { rotateFormationOffset, tacticalFormationLayout } from './formations';

describe('tactical formations', () => {
  it('transitions from a deep staggered column to a wedge and then a shallow battle line', () => {
    const compact = tacticalFormationLayout(12, 7, 9);
    const wedge = tacticalFormationLayout(12, 7, 30);
    const line = tacticalFormationLayout(12, 7, 72);

    expect(compact.kind).toBe('staggered-column');
    expect(wedge.kind).toBe('wedge');
    expect(line.kind).toBe('battle-line');
    expect(compact.width).toBeLessThan(wedge.width);
    expect(wedge.width).toBeLessThan(line.width);
    expect(compact.depth).toBeGreaterThan(line.depth);
    expect(line.rows).toBeGreaterThanOrEqual(2);
  });

  it('keeps every generated slot distinct and safely spaced', () => {
    for (const spread of [8, 24, 64]) {
      const layout = tacticalFormationLayout(18, 6, spread);
      expect(layout.offsets).toHaveLength(18);
      for (let a = 0; a < layout.offsets.length; a++) {
        for (let b = a + 1; b < layout.offsets.length; b++) {
          const dx = layout.offsets[a].x - layout.offsets[b].x;
          const dz = layout.offsets[a].z - layout.offsets[b].z;
          expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(5.9);
        }
      }
    }
  });

  it('rotates local formation slots into the requested facing', () => {
    const offset = rotateFormationOffset({ x: 10, z: 4 }, Math.PI / 2);
    expect(offset.x).toBeCloseTo(-4, 6);
    expect(offset.z).toBeCloseTo(-10, 6);
  });
});
