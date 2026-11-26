import { describe, expect, it, vi } from 'vitest';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim, setSelected, spawnTankAt, spawnWaspAt } from '../sim/world';
import { RtsController } from '../modes/rtsController';
import { blockedRouteReason, clearMovementRejections, filterWaterOrders } from './movementRejection';
import { groupOrderFeedback } from './orderFeedback';

function lake() {
  const hf = generateHeightfield({ cells: 32, cellSize: 2, waterLevel: 0, seed: 41, oreFieldCount: 0 });
  hf.heights.fill(2); hf.walkable.fill(1);
  for (let y = 0; y < hf.samples; y++) for (let x = hf.samples / 2 | 0; x < hf.samples; x++) hf.heights[y * hf.samples + x] = -2;
  const sim = createGameSim(hf);
  const tank = spawnTankAt(sim, -15, 0, 'Tank', 1), air = spawnWaspAt(sim, hf, -15, -10, 'Aircraft', 1);
  return { hf, sim, tank, air };
}

describe('water order feedback', () => {
  it('rejects ground water orders without mutating previous orders, and still permits aircraft', () => {
    const { hf, tank, air } = lake();
    tank.mover!.target = { x: -20, z: 10 };
    const previous = JSON.stringify(tank.mover);
    expect(filterWaterOrders([tank, air], [{ x: 20, z: 0 }], hf)).toEqual([air]);
    expect(JSON.stringify(tank.mover)).toBe(previous);
    expect(blockedRouteReason(tank)).toBe('water');
    expect(blockedRouteReason(air)).toBeUndefined();
    expect(groupOrderFeedback([tank], 1).status).toContain('route blocked');
    expect(groupOrderFeedback([tank], 1).status).toContain('moving');
    tank.mover!.target = undefined; // The previous valid order may finish normally.
    expect(blockedRouteReason(tank)).toBe('water');
  });
  it('checks every drawn waypoint and clears the warning after a land order or stop', () => {
    const { hf, tank } = lake();
    expect(filterWaterOrders([tank], [{ x: -10, z: 0 }, { x: 20, z: 0 }, { x: -10, z: 20 }], hf)).toEqual([]);
    expect(blockedRouteReason(tank)).toBe('water');
    expect(filterWaterOrders([tank], [{ x: -10, z: 0 }], hf)).toEqual([tank]);
    expect(blockedRouteReason(tank)).toBeUndefined();
    filterWaterOrders([tank], [{ x: 20, z: 0 }], hf);
    clearMovementRejections([tank]);
    expect(blockedRouteReason(tank)).toBeUndefined();
  });
  it('does not leave a rejection label attached after another system replaces the order', () => {
    const { hf, tank } = lake();
    filterWaterOrders([tank], [{ x: 20, z: 0 }], hf);
    tank.mover!.target = { x: -10, z: 10 };
    expect(blockedRouteReason(tank)).toBeUndefined();
  });
  it('does not send a ground command or success marker for a lake click, including multiplayer', () => {
    const { hf, sim, tank } = lake();
    setSelected(sim, [tank], false, 1);
    const move = vi.fn(() => true), showOrder = vi.fn(), feedback = vi.fn();
    const controller = Object.assign(Object.create(RtsController.prototype), {
      enabled: true, localTeam: 1, sim, hf,
      commandSink: { move }, orderFeedback: { showOrder }, flashControlGroup: feedback,
    }) as RtsController;
    expect(controller.orderSelectedTo(20, 0)).toBe(false);
    expect(move).not.toHaveBeenCalled(); expect(showOrder).not.toHaveBeenCalled();
    expect(feedback).toHaveBeenCalledWith('ROUTE BLOCKED · GROUND UNITS CANNOT ENTER WATER');
    expect(blockedRouteReason(tank)).toBe('water');
    expect(controller.orderSelectedTo(-10, 10)).toBe(true);
    expect(move).toHaveBeenCalledOnce(); expect(showOrder).toHaveBeenCalledWith(-10, 10, 'move', 1);
    expect(blockedRouteReason(tank)).toBeUndefined();
  });
});
