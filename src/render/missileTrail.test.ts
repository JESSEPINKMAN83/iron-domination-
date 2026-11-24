import { describe, expect, it } from 'vitest';
import { BufferAttribute, DynamicDrawUsage, Vector3 } from 'three';
import { createMissileTrail, MissileTrailHistory, updateMissileTrail } from './missileTrail';

describe('missile trail continuity', () => {
  it('keeps the same trail age and positions at 30, 60 and 144 Hz', () => {
    const histories = [30, 60, 144].map((fps) => {
      const history = new MissileTrailHistory(28, new Vector3());
      for (let i = 1; i <= fps * 2; i++) history.advance(new Vector3(i / fps * 90, 10, 0), 1 / fps);
      return history;
    });
    for (const history of histories) {
      expect(history.points).toHaveLength(28);
      expect(history.points.at(-1)!.x).toBeCloseTo(180);
      expect(history.points[0].x).toBeCloseTo(histories[0].points[0].x);
    }
  });
  it('reuses bounded storage through stalls and a long battle', () => {
    const history = new MissileTrailHistory(22, new Vector3());
    const vectors = new Set(history.points);
    for (let i = 0; i < 1000; i++) {
      history.advance(new Vector3(i, 5, i), i === 500 ? 30 : 1 / 60);
      history.points.forEach((p) => vectors.add(p));
      expect(history.points.length).toBeLessThanOrEqual(22);
      expect(history.points.every((p) => Number.isFinite(p.x))).toBe(true);
    }
    expect(vectors.size).toBe(22);
  });
  it('updates a single preallocated transparent draw with finite colors', () => {
    const trail = createMissileTrail('strategicMissile');
    const positions = trail.geometry.getAttribute('position');
    const colors = trail.geometry.getAttribute('color');
    const history = new MissileTrailHistory(48, new Vector3());
    for (let i = 1; i <= 200; i++) {
      history.advance(new Vector3(i, Math.sin(i), i), 1 / 60);
      updateMissileTrail(trail, history.points);
    }
    expect(trail.geometry.getAttribute('position')).toBe(positions);
    expect((positions as BufferAttribute).usage).toBe(DynamicDrawUsage);
    expect(trail.geometry.drawRange.count).toBe((48 - 1) * 12);
    expect([...colors.array].every(Number.isFinite)).toBe(true);
    expect(trail.material.forceSinglePass).toBe(true);
    trail.geometry.dispose(); trail.material.dispose();
  });
});
