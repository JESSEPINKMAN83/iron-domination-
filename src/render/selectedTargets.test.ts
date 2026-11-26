import { describe, expect, it } from 'vitest';
import { InstancedMesh, LineSegments } from 'three';
import type { Entity } from '../sim/components';
import { generateHeightfield } from '../sim/heightfield';
import { MAX_SELECTED_TARGETS, SelectedTargetView, selectedTargets, selectedTargetSummary } from './selectedTargets';
const entity = (id: number): Entity => ({ id, name: `Unit ${id}`, transform: { x: id, z: 0, rot: 0 }, previousTransform: { x: id, z: 0, rot: 0 }, health: { current: 100, max: 100 } });

describe('selected weapon target feedback', () => {
  it('deduplicates aliased weapon slots, distinguishes ordered targets and excludes hidden/dead ones', () => {
    const unit = entity(1), active = entity(2), ordered = entity(3);
    unit.weapon = { kind: 'tankGun', range: 100, cooldown: 1, targetId: 2 };
    unit.weapons = { primary: unit.weapon };
    unit.mover = { speed: 20, radius: 3, attackTargetId: 3 };
    const byId = new Map([unit, active, ordered].map(e => [e.id, e]));
    const records = selectedTargets([unit], byId, () => true);
    expect(records.map(r => [r.target.id, r.engaging])).toEqual([[2, true], [3, false]]);
    expect(selectedTargetSummary(records)).toBe('Engaging (1): Unit 2 · Ordered (1): Unit 3');
    expect(selectedTargets([unit], byId, () => true, () => false).every(r => !r.engaging)).toBe(true);
    expect(selectedTargets([unit], byId, e => e.id !== 2).map(r => r.target.id)).toEqual([3]);
    ordered.destroyed = { remaining: 7 }; active.health!.current = 0;
    expect(selectedTargets([unit], byId, () => true)).toEqual([]);
  });
  it('caps target buffers, shares target rings and clears all visuals with selection', () => {
    const target = entity(999);
    const units = Array.from({ length: 100 }, (_, i) => { const unit = entity(i); unit.weapon = { kind: 'tankGun', range: 100, cooldown: 0, targetId: 999 }; return unit; });
    const records = selectedTargets(units, new Map([[999, target]]), () => true);
    expect(records).toHaveLength(MAX_SELECTED_TARGETS);
    const hf = generateHeightfield({ cells: 32, cellSize: 2, waterLevel: -100, seed: 41, oreFieldCount: 0 });
    const view = new SelectedTargetView(hf); view.update(records);
    const lines = view.group.children.find(c => c instanceof LineSegments) as LineSegments;
    const rings = view.group.children.find(c => c instanceof InstancedMesh) as InstancedMesh;
    expect(lines.geometry.drawRange.count).toBe(MAX_SELECTED_TARGETS * 2);
    expect(rings.count).toBe(1);
    expect(view.group.children).toHaveLength(2);
    const positions = lines.geometry.getAttribute('position');
    view.update([]);
    expect(view.group.visible).toBe(false);
    expect(rings.count).toBe(0);
    expect(lines.geometry.getAttribute('position')).toBe(positions);
  });
});
