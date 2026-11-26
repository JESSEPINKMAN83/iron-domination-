import { describe, expect, it } from 'vitest';
import { Line } from 'three';
import { OrderMarkerView } from './orderMarkerView';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from '../sim/heightfield';

describe('accepted route feedback', () => {
  it('reuses one bounded buffer, replaces previous paths, conforms to terrain and expires', () => {
    const hf = generateHeightfield(MAP01);
    const view = new OrderMarkerView(hf);
    view.showRoute([{ x: 0, z: 0 }, { x: 40, z: 10 }, { x: 50, z: 40 }]);
    const line = view.group.children.find(c => c instanceof Line) as Line;
    const attribute = line.geometry.getAttribute('position');
    expect(line.geometry.drawRange.count).toBe(17);
    expect(attribute.getX(16)).toBe(50);
    expect(attribute.getZ(16)).toBe(40);
    view.showRoute([{ x: -10, z: -10 }, { x: 10, z: 10 }]);
    expect(view.group.children.filter(c => c instanceof Line)).toHaveLength(1);
    expect(line.geometry.getAttribute('position')).toBe(attribute);
    expect(line.geometry.drawRange.count).toBe(9);
    expect(attribute.getX(8)).toBe(10);
    view.clearRoute();
    expect(line.visible).toBe(false);
    view.showRoute([{ x: 0, z: 0 }, { x: 10, z: 10 }]);
    expect(line.visible).toBe(true);
    view.update(3.1);
    expect(line.visible).toBe(false);
    view.showRoute([{ x: 0, z: 0 }]);
    expect(line.visible).toBe(false);
  });
});
