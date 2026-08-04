import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { stepSim, createGameSim, spawnTankAt, spawnEnemyTanks, issueMoveOrder } from './world';
import { issueTacticOrder, MAX_TACTIC_WAYPOINTS } from './tactics';

describe('tactic orders', () => {
  it('queues waypoints and advances after each arrival', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Scout', 1);
    const waypoints = [
      { x: 20, z: 0 },
      { x: 40, z: 0 },
      { x: 60, z: 0 },
    ];

    expect(issueTacticOrder(sim, [tank], waypoints, { kind: 'hold' })).toBe(true);
    expect(tank.mover?.target).toEqual({ x: 20, z: 0 });
    expect(tank.mover?.tactic?.remaining).toEqual([
      { x: 40, z: 0 },
      { x: 60, z: 0 },
    ]);

    // Drive the unit toward the first waypoint until the tactic advances.
    for (let i = 0; i < 900 && (tank.mover?.tactic?.remaining.length ?? 0) > 1; i++) {
      stepSim(sim, hf, 1 / 30);
    }
    expect(tank.mover?.tactic?.remaining.length).toBeLessThan(2);
    expect(tank.mover?.target || tank.mover?.holdPosition).toBeTruthy();

    for (let i = 0; i < 1200 && tank.mover?.tactic; i++) {
      stepSim(sim, hf, 1 / 30);
    }
    expect(tank.mover?.tactic).toBeUndefined();
    expect(tank.mover?.holdPosition).toBeTruthy();
    expect(tank.mover?.attackMove).toBeFalsy();
  });

  it('applies attack-move at the end of the path', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Scout', 1);

    expect(issueTacticOrder(sim, [tank], [{ x: 18, z: 0 }], { kind: 'attack-move' })).toBe(true);
    for (let i = 0; i < 900 && tank.mover?.tactic; i++) stepSim(sim, hf, 1 / 30);

    expect(tank.mover?.tactic).toBeUndefined();
    expect(tank.mover?.attackMove).toBe(true);
  });

  it('applies attack end action against a living target', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Scout', 1);
    const foes = spawnEnemyTanks(sim, hf, 1);
    const foe = foes[0];
    foe.transform.x = 80;
    foe.transform.z = 0;

    expect(
      issueTacticOrder(sim, [tank], [{ x: 24, z: 0 }], { kind: 'attack', targetId: foe.id }),
    ).toBe(true);

    for (let i = 0; i < 1200 && tank.mover?.tactic; i++) stepSim(sim, hf, 1 / 30);
    expect(tank.mover?.tactic).toBeUndefined();
    expect(tank.mover?.attackTargetId).toBe(foe.id);
    expect(tank.mover?.attackMove).toBe(true);
  });

  it('rejects empty or oversized waypoint lists', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Scout', 1);
    expect(issueTacticOrder(sim, [tank], [], { kind: 'hold' })).toBe(false);
    const tooMany = Array.from({ length: MAX_TACTIC_WAYPOINTS + 1 }, (_, i) => ({ x: i * 5, z: 0 }));
    expect(issueTacticOrder(sim, [tank], tooMany, { kind: 'hold' })).toBe(false);
  });

  it('rejects an attack tactic aimed at a friendly unit', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Scout', 1);
    const ally = spawnTankAt(sim, 40, 0, 'Ally', 1);

    expect(
      issueTacticOrder(sim, [tank], [{ x: 20, z: 0 }], { kind: 'attack', targetId: ally.id }),
    ).toBe(false);
    expect(tank.mover?.tactic).toBeUndefined();
  });

  it('clears a tactic when a normal move order is issued', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Scout', 1);
    expect(issueTacticOrder(sim, [tank], [{ x: 30, z: 0 }, { x: 50, z: 0 }], { kind: 'hold' })).toBe(true);
    expect(tank.mover?.tactic).toBeTruthy();

    issueMoveOrder(sim, [tank], 10, 10, false);
    expect(tank.mover?.tactic).toBeUndefined();
  });
});
