import { describe, expect, it } from 'vitest';
import { createGameSim } from '../sim/world';
import { generateHeightfield } from '../sim/heightfield';
import type { Entity } from '../sim/components';
import { UnitLossTracker } from './unitLossTracker';

const unit = (id: number, team = 1, name = 'Test unit'): Entity => ({
  id, name, team: { id: team }, transform: { x: 0, z: 0 },
  health: { current: 100, max: 100 }, selectable: { type: 'aircraft', selected: false, radius: 2 },
} as Entity);
function fixture() {
  const sim = createGameSim(generateHeightfield({ cells: 16, cellSize: 4, seed: 7, waterLevel: -10, oreFieldCount: 0 }));
  return { sim, tracker: new UnitLossTracker(sim, 1) };
}
describe('local unit loss history', () => {
  it('counts all splash casualties without requiring individual combat events, once each', () => {
    const { sim, tracker } = fixture();
    const a = unit(100), b = unit(101), c = unit(102, 1, 'Different unit');
    for (const e of [a, b, c]) sim.world.add(e);
    for (const e of [a, b, c]) e.health!.current = 0;
    sim.tick = 3; tracker.update();
    expect(tracker.total).toBe(3);
    expect(tracker.reports).toHaveLength(1);
    expect(tracker.reports[0].count).toBe(3);
    expect(tracker.totals.size).toBe(2);
    for (const e of [a, b, c]) sim.world.remove(e);
    sim.tick = 9; tracker.update();
    expect(tracker.total).toBe(3);
  });
  it('ignores hostile units, buildings, and living entities removed during recovery', () => {
    const { sim, tracker } = fixture();
    const hostile = unit(100, 2), building = { ...unit(101), building: {} } as Entity, live = unit(102);
    for (const e of [hostile, building, live]) sim.world.add(e);
    hostile.health!.current = 0; building.health!.current = 0; sim.world.remove(live);
    sim.tick = 3; tracker.update();
    expect(tracker.total).toBe(0);
  });
  it('captures crashes/removal and starts a new timestamped report after the grouping window', () => {
    const { sim, tracker } = fixture();
    const a = unit(100), b = unit(101);
    sim.world.add(a); sim.world.add(b);
    a.destroyed = { remaining: 0 }; sim.tick = 30; sim.world.remove(a);
    expect(tracker.total).toBe(1);
    b.health!.current = 0; sim.tick = 180; tracker.update();
    expect(tracker.total).toBe(2);
    expect(tracker.reports.map(r => r.tick)).toEqual([30, 180]);
  });
  it('does not announce wrecks already present in a loaded match', () => {
    const { sim } = fixture(); const wreck = unit(100); wreck.destroyed = { remaining: 10 }; sim.world.add(wreck);
    const tracker = new UnitLossTracker(sim, 1);
    sim.tick = 3; tracker.update(); sim.world.remove(wreck);
    expect(tracker.total).toBe(0);
  });
});
