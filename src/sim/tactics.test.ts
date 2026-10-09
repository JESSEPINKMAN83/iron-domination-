import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { stepSim, createGameSim, spawnTankAt, spawnEnemyTanks, issueMoveOrder, stopEntities, hashSim, spawnWaspAt, spawnVultureAt, spawnHammerheadAt } from './world';
import { manualFireAt, stepCombat } from './combat';
import { loadSerializedSim, serializeSim } from './serialize';
import { issueTacticOrder, MAX_TACTIC_WAYPOINTS } from './tactics';
import { spawnInfantryAt } from './economy';

describe('tactic orders', () => {
  it.each(['tank', 'infantry'] as const)('keeps a %s route authoritative during automatic retaliation', (kind) => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const unit = kind === 'tank' ? spawnTankAt(sim, 0, 0, 'Route', 1) : spawnInfantryAt(sim, 0, 0, 1, 'infantry');
    unit.health!.current = unit.health!.max = 10000;
    const defender = spawnTankAt(sim, 35, 25, 'Defender', 2);
    defender.weapon = { kind: 'waspAutocannon', range: 220, cooldown: 0 };
    defender.weapons = undefined;
    defender.turret!.turnRate = 20;
    defender.health!.current = defender.health!.max = 10000;
    defender.mover!.attackMove = true;
    issueTacticOrder(sim, [unit], [{ x: 20, z: 0 }, { x: 40, z: 0 }, { x: 80, z: 0 }], { kind: 'attack-through' });
    for (let i = 0; i < 1800 && unit.mover!.tactic; i++) {
      // Retaliation state must never become the navigation authority.
      unit.mover!.engage = { x: defender.transform.x, z: defender.transform.z };
      stepSim(sim, hf, 1 / 30);
      stepCombat(sim, 1 / 30);
      if (unit.mover!.tactic) {
        expect(unit.mover!.engage).toBeUndefined();
        expect(Math.hypot(unit.velocity!.x, unit.velocity!.z)).toBeGreaterThan(0.1);
      }
      sim.events.length = 0;
    }
    expect(unit.health!.current).toBeLessThan(10000);
    expect(defender.health!.current).toBeLessThan(10000);
    expect(unit.mover!.tactic).toBeUndefined();
    expect(unit.mover!.holdPosition).toEqual({ x: 80, z: 0 });
  });
  it.each([spawnWaspAt, spawnVultureAt, spawnHammerheadAt])('never hovers on a sharp-turn route while trading fire with an enemy', (spawn) => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const aircraft = spawn(sim, hf, 0, 0, 'Route', 1);
    aircraft.health!.current = aircraft.health!.max = 10000;
    const defender = spawnTankAt(sim, 70, 30, 'AA defender', 2);
    defender.weapon = { kind: 'waspAutocannon', range: 220, cooldown: 0 };
    defender.turret!.turnRate = 20;
    defender.weapons = undefined;
    defender.vision = { radius: 300 };
    defender.health!.current = defender.health!.max = 10000;
    defender.mover!.attackMove = true;
    const path = [{ x: 40, z: 0 }, { x: -30, z: 0 }, { x: 60, z: 60 }, { x: 170, z: 0 }];
    issueTacticOrder(sim, [aircraft], path, { kind: 'attack-through' });
    let arrivals = 0;
    for (let i = 0; i < 30 * 30 && aircraft.mover!.tactic; i++) {
      const previousRemaining = aircraft.mover!.tactic.remaining.length;
      stepSim(sim, hf, 1 / 30);
      stepCombat(sim, 1 / 30);
      if (aircraft.mover!.tactic) {
        expect(Math.hypot(aircraft.velocity!.x, aircraft.velocity!.z)).toBeGreaterThan(aircraft.mover!.speed * 0.95);
        if (aircraft.mover!.tactic.remaining.length < previousRemaining) arrivals++;
      }
      sim.events.length = 0;
    }
    expect(arrivals).toBe(3);
    expect(aircraft.health!.current).toBeLessThan(10000);
    expect(defender.health!.current).toBeLessThan(10000);
    expect(aircraft.mover!.tactic).toBeUndefined();
    expect(aircraft.transform.x).toBe(170);
    expect(aircraft.transform.z).toBe(0);
  });
  it.each([spawnWaspAt, spawnVultureAt, spawnHammerheadAt])('completes aircraft routes under repeated incoming fire without hit-induced braking', (spawn) => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const unit = spawn(sim, hf, 0, 0, 'Under fire', 1);
    const attacker = spawnWaspAt(sim, hf, -30, 0, 'Enemy', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    issueTacticOrder(sim, [unit], [{ x: 50, z: 0 }, { x: 110, z: 0 }, { x: 170, z: 0 }], { kind: 'attack-through' });
    let hits = 0;
    for (let i = 0; i < 1800 && unit.mover!.tactic; i++) {
      if (i % 15 === 0) {
        unit.health!.current = unit.health!.max;
        attacker.transform = { ...unit.transform, x: unit.transform.x - 30, rot: Math.PI / 2 };
        attacker.turret!.yaw = Math.PI / 2;
        attacker.weapon!.cooldown = 0;
        const beforeVelocity = { ...unit.velocity! };
        manualFireAt(sim, attacker, unit.transform.x, unit.transform.z, 'primary', unit.transform.y);
        if (unit.health!.current < unit.health!.max) {
          hits++;
          expect(unit.velocity).toEqual(beforeVelocity);
          expect(unit.mover!.target).toBeDefined();
          expect(unit.mover!.attackThrough).toBe(true);
        }
      }
      stepSim(sim, hf, 1 / 30);
      stepCombat(sim, 1 / 30, { autoFire: false });
      sim.events.length = 0;
    }
    expect(hits).toBeGreaterThan(5);
    expect(unit.mover!.tactic).toBeUndefined();
    expect(unit.mover!.holdPosition).toEqual({ x: 170, z: 0 });
  });
  it.each([spawnWaspAt, spawnVultureAt, spawnHammerheadAt])('keeps aircraft moving through waypoints while firing off the flight heading', (spawn) => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const aircraft = spawn(sim, hf, 0, 0, 'Route', 1);
    const foe = spawnTankAt(sim, 65, 60, 'Off-axis foe', 2);
    foe.weapon = undefined;
    foe.weapons = undefined;
    foe.health!.current = foe.health!.max = 100000;
    issueTacticOrder(sim, [aircraft], [{ x: 50, z: 0 }, { x: 110, z: 0 }, { x: 170, z: 0 }], { kind: 'attack-through' });
    let movingTransitions = 0;
    let firedOnRoute = false;
    for (let i = 0; i < 1800; i++) {
      const remaining = aircraft.mover!.tactic?.remaining.length;
      stepSim(sim, hf, 1 / 30);
      stepCombat(sim, 1 / 30);
      if (remaining !== undefined && aircraft.mover!.tactic && aircraft.mover!.tactic.remaining.length < remaining) {
        expect(Math.hypot(aircraft.velocity!.x, aircraft.velocity!.z)).toBeGreaterThan(1);
        movingTransitions++;
      }
      firedOnRoute ||= !!aircraft.mover!.tactic && foe.health!.current < foe.health!.max;
      sim.events.length = 0;
    }
    expect(movingTransitions).toBe(2);
    expect(firedOnRoute).toBe(true);
    expect(aircraft.mover!.tactic).toBeUndefined();
    expect(aircraft.mover!.holdPosition).toEqual({ x: 170, z: 0 });
    expect(Math.hypot(aircraft.transform.x - 170, aircraft.transform.z)).toBeLessThan(9);
  });
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
