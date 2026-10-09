import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { stepSim, createGameSim, spawnTankAt, spawnEnemyTanks, issueMoveOrder, stopEntities, hashSim, spawnWaspAt } from './world';
import { stepCombat } from './combat';
import { loadSerializedSim, serializeSim } from './serialize';
import { issueTacticOrder, MAX_TACTIC_WAYPOINTS } from './tactics';

describe('tactic orders', () => {
  it('keeps independent routes for a selected squad and completes aircraft waypoints', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const squad = [spawnTankAt(sim, 0, 0, 'One'), spawnTankAt(sim, 0, 10, 'Two')];
    const aircraft = spawnWaspAt(sim, hf, 0, -20, 'Air');
    issueTacticOrder(sim, squad, [{ x: 20, z: 0 }, { x: 60, z: 0 }], { kind: 'attack-through' });
    issueTacticOrder(sim, [aircraft], [{ x: 20, z: -20 }, { x: 60, z: -20 }], { kind: 'attack-through' });
    expect(squad[0].mover?.tactic).not.toBe(squad[1].mover?.tactic);
    for (let i = 0; i < 1800; i++) stepSim(sim, hf, 1 / 30);
    for (const unit of [...squad, aircraft]) {
      expect(unit.mover?.tactic).toBeUndefined();
      expect(unit.mover?.attackThrough).toBe(true);
      expect(unit.mover?.holdPosition?.x).toBe(60);
      expect(Math.abs(unit.transform.x - 60)).toBeLessThan(5);
    }
  });
  it.each([true, false])('fires while completing the route with automatic combat %s, then holds without chasing', (autoCombat) => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = autoCombat;
    const tank = spawnTankAt(sim, 0, 0, 'Route', 1);
    const foe = spawnTankAt(sim, 30, 25, 'Foe', 2);
    foe.weapon = undefined;
    foe.weapons = undefined;
    foe.health!.current = foe.health!.max = 100000;
    const path = [{ x: 20, z: 0 }, { x: 40, z: 0 }, { x: 60, z: 0 }];
    expect(issueTacticOrder(sim, [tank], path, { kind: 'attack-through' })).toBe(true);
    let firedOnRoute = false;
    let reachedSecondLeg = false;
    for (let i = 0; i < 900; i++) {
      stepSim(sim, hf, 1 / 30);
      stepCombat(sim, 1 / 30);
      firedOnRoute ||= !!tank.mover?.tactic && sim.events.some((e) => e.sourceTeamId === 1 && e.targetId === foe.id);
      reachedSecondLeg ||= tank.mover?.tactic?.remaining.length === 1;
      sim.events.length = 0;
    }
    expect(firedOnRoute).toBe(true);
    expect(reachedSecondLeg).toBe(true);
    expect(tank.mover?.tactic).toBeUndefined();
    expect(tank.mover?.holdPosition).toEqual(path[2]);
    expect(Math.hypot(tank.transform.x - 60, tank.transform.z)).toBeLessThan(1);
    expect(tank.mover?.engage).toBeUndefined();
    // A foe just outside weapon range must not pull the unit away from the endpoint.
    foe.transform.x = 60 + (tank.weapon?.range ?? 50) + 5;
    foe.transform.z = 0;
    for (let i = 0; i < 120; i++) { stepSim(sim, hf, 1 / 30); stepCombat(sim, 1 / 30); }
    expect(Math.hypot(tank.transform.x - 60, tank.transform.z)).toBeLessThan(1);
    expect(tank.mover?.engage).toBeUndefined();
  });

  it('retains the route through a heavy hit and resumes toward the endpoint', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Route', 1);
    issueTacticOrder(sim, [tank], [{ x: 20, z: 0 }, { x: 60, z: 0 }], { kind: 'attack-through' });
    tank.impactMomentum = { x: -12, z: 8, yaw: 0.2, ttl: 1, stagger: 0.3 };
    for (let i = 0; i < 1200 && tank.mover?.tactic; i++) stepSim(sim, hf, 1 / 30);
    expect(tank.mover?.tactic).toBeUndefined();
    expect(tank.mover?.holdPosition).toEqual({ x: 60, z: 0 });
    expect(tank.mover?.attackThrough).toBe(true);
  });

  it('preserves attack-through in saved state and includes it in multiplayer hashes', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Route', 1);
    issueTacticOrder(sim, [tank], [{ x: 20, z: 0 }, { x: 60, z: 0 }], { kind: 'attack-through' });
    const restored = loadSerializedSim(hf, serializeSim(sim));
    expect(hashSim(restored)).toBe(hashSim(sim));
    tank.mover!.attackThrough = undefined;
    expect(hashSim(restored)).not.toBe(hashSim(sim));
  });

  it('clears route-first combat when replaced by move or stop', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Route', 1);
    issueTacticOrder(sim, [tank], [{ x: 20, z: 0 }], { kind: 'attack-through' });
    issueMoveOrder(sim, [tank], 40, 0);
    expect(tank.mover?.attackThrough).toBeUndefined();
    issueTacticOrder(sim, [tank], [{ x: 20, z: 0 }], { kind: 'attack-through' });
    stopEntities([tank]);
    expect(tank.mover?.attackThrough).toBeUndefined();
    expect(tank.mover?.tactic).toBeUndefined();
  });
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

  it('keeps high speed enabled across every tactic waypoint', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'Scout', 1);

    expect(issueTacticOrder(sim, [tank], [{ x: 20, z: 0 }, { x: 40, z: 0 }], { kind: 'hold' }, true)).toBe(true);
    expect(tank.mover?.sprint).toBe(true);
    expect(tank.mover?.tactic?.sprint).toBe(true);

    for (let i = 0; i < 900 && (tank.mover?.tactic?.remaining.length ?? 0) > 0; i++) {
      stepSim(sim, hf, 1 / 30);
    }

    expect(tank.mover?.sprint).toBe(true);
    expect(tank.mover?.tactic?.sprint).toBe(true);
  });
});
