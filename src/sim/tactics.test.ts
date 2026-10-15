import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { aircraftTurnRateAtSpeed, stepSim, createGameSim, spawnTankAt, spawnEnemyTanks, issueMoveOrder, setAggressiveMode, stopEntities, hashSim, spawnWaspAt, spawnVultureAt, spawnHammerheadAt } from './world';
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
  it.each([spawnWaspAt, spawnVultureAt, spawnHammerheadAt])('keeps smooth turns in nonzero-variation mode while trading fire with an enemy', (spawn) => {
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
    issueTacticOrder(sim, [aircraft], path, { kind: 'attack-through' }, false, 0.5);
    let arrivals = 0;
    for (let i = 0; i < 30 * 30 && aircraft.mover!.tactic; i++) {
      const previousRemaining = aircraft.mover!.tactic.remaining.length;
      const previousSpeed = Math.hypot(aircraft.velocity!.x, aircraft.velocity!.z);
      const previousHeading = Math.atan2(aircraft.velocity!.x, aircraft.velocity!.z);
      stepSim(sim, hf, 1 / 30);
      stepCombat(sim, 1 / 30);
      if (aircraft.mover!.tactic) {
        expect(Math.hypot(aircraft.velocity!.x, aircraft.velocity!.z)).toBeGreaterThan(0.1);
        if (previousSpeed > 1) {
          const heading = Math.atan2(aircraft.velocity!.x, aircraft.velocity!.z);
          const delta = Math.atan2(Math.sin(heading - previousHeading), Math.cos(heading - previousHeading));
          expect(Math.abs(delta)).toBeLessThanOrEqual(3.4 / 30 + 0.00001);
        }
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
      expect(Math.abs((unit.mover?.holdPosition?.x ?? 0) - 60)).toBeLessThan(20);
      expect(Math.abs(unit.transform.x - 60)).toBeLessThan(20);
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


it('widens the turn radius at cruise and boost speeds', () => {
  const hover = aircraftTurnRateAtSpeed(2.6, 1.3, 0, 46);
  const cruise = aircraftTurnRateAtSpeed(2.6, 1.3, 46, 46);
  const boost = aircraftTurnRateAtSpeed(2.6, 1.3, 92, 46);
  expect(cruise).toBeLessThan(hover);
  expect(boost).toBeLessThan(cruise);
  expect(92 / boost).toBeGreaterThan(46 / cruise);
});

it.each([spawnWaspAt, spawnVultureAt, spawnHammerheadAt])('carries sprint speed through intermediate straight waypoints', (spawn) => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const unit = spawn(sim, hf, -150, 0, 'Fly-through', 1);
  unit.transform.rot = Math.PI / 2;
  const speed = unit.mover!.speed * 1.65;
  unit.velocity!.x = speed;
  unit.velocity!.z = 0;
  issueTacticOrder(sim, [unit], [{ x: -30, z: 0 }, { x: 80, z: 0 }, { x: 180, z: 0 }], { kind: 'attack-through' }, true);
  let transitions = 0;
  for (let tick = 0; tick < 600 && unit.mover!.tactic; tick++) {
    const remaining = unit.mover!.tactic.remaining.length;
    stepSim(sim, hf, 1 / 30);
    if (unit.mover!.tactic && unit.mover!.tactic.remaining.length < remaining) {
      transitions++;
      expect(Math.hypot(unit.velocity!.x, unit.velocity!.z)).toBeGreaterThan(speed * 0.95);
    }
  }
  expect(transitions).toBe(2);
  expect(unit.mover!.tactic).toBeUndefined();
});


it('gives twenty aircraft distinct spaced final positions and staggered deterministic departures', () => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const squad = Array.from({ length: 20 }, (_, i) => spawnHammerheadAt(sim, hf, -100, i - 10, `Flight ${i}`, 1));
  issueTacticOrder(sim, squad, [{ x: 0, z: 0 }, { x: 100, z: 0 }], { kind: 'attack-through' }, false, 1);
  const destinations = squad.map((unit) => unit.mover!.tactic!.remaining[0]);
  expect(new Set(destinations.map((p) => `${p.x},${p.z}`)).size).toBe(20);
  expect(new Set(squad.map((unit) => unit.mover!.tactic!.startAtTick)).size).toBeGreaterThan(10);
  for (let tick = 0; tick < 30 * 45; tick++) stepSim(sim, hf, 1 / 30);
  expect(squad.every((unit) => !unit.mover!.tactic)).toBe(true);
  for (let i = 0; i < squad.length; i++) {
    expect(Math.abs(squad[i].transform.x - destinations[i].x)).toBeLessThan(2);
    expect(Math.abs(squad[i].transform.z - destinations[i].z)).toBeLessThan(2);
    for (let j = i + 1; j < squad.length; j++) {
      expect(Math.hypot(squad[i].transform.x - squad[j].transform.x, squad[i].transform.z - squad[j].transform.z)).toBeGreaterThan(7.6);
    }
  }
});


it('accepts a 64-point route and preserves every remaining waypoint', () => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const unit = spawnWaspAt(sim, hf, -180, 0, 'Long route', 1);
  const path = Array.from({ length: 64 }, (_, i) => ({ x: -160 + i * 5, z: Math.sin(i / 6) * 35 }));
  expect(issueTacticOrder(sim, [unit], path, { kind: 'attack-through' })).toBe(true);
  expect(unit.mover!.tactic!.remaining).toEqual(path.slice(1));
});

it.each([spawnWaspAt, spawnVultureAt, spawnHammerheadAt])('finishes a dense drawn route and fires at its selected target in manual combat', (spawn) => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  sim.rules.autoCombat = false;
  const aircraft = spawn(sim, hf, 0, 0, 'Route', 1);
  const enemy = spawnTankAt(sim, 90, 20, 'Target', 2);
  enemy.health!.current = enemy.health!.max = 100000;
  const path = Array.from({ length: 40 }, (_, i) => ({ x: i * 2, z: Math.sin(i / 8) * 12 }));
  expect(issueTacticOrder(sim, [aircraft], path, { kind: 'attack', targetId: enemy.id }, true)).toBe(true);
  for (let i = 0; i < 1800; i++) {
    stepSim(sim, hf, 1 / 30);
    stepCombat(sim, 1 / 30);
    sim.events.length = 0;
  }
  expect(aircraft.mover!.tactic).toBeUndefined();
  expect(enemy.health!.current).toBeLessThan(100000);
});

it.each([false, true])('completes every zero-variation route leg under fire (sprint=%s)', (sprint) => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const squad = Array.from({ length: 9 }, (_, i) => [spawnWaspAt, spawnVultureAt, spawnHammerheadAt][i % 3](sim, hf, -80, -10 + i * 3, `Exact ${i}`, 1));
  const path = [{ x: 0, z: 0 }, { x: 35, z: 0 }, { x: 35, z: 25 }, { x: 5, z: 25 }, { x: 5, z: 5 }, { x: 80, z: 5 }];
  const enemy = spawnTankAt(sim, 40, 15, 'Defender', 2);
  enemy.weapon = { kind: 'aaMissile', range: 200, cooldown: 0 };
  enemy.weapons = undefined;
  enemy.health!.current = enemy.health!.max = 100000;
  squad.forEach((unit) => { unit.health!.current = unit.health!.max = 100000; });
  expect(issueTacticOrder(sim, squad, path, { kind: 'attack-through' }, sprint, 0)).toBe(true);
  const visited = squad.map(() => 0);
  squad.forEach((unit) => {
    expect(unit.mover!.target).toMatchObject(path[0]);
    expect(unit.mover!.tactic!.remaining).toEqual(path.slice(1));
    expect(unit.mover!.tactic!.startAtTick).toBe(sim.tick);
  });
  for (let tick = 0; tick < 1800 && squad.some((u) => u.mover!.tactic); tick++) {
    const targets = squad.map((unit) => unit.mover!.tactic && unit.mover!.target && { ...unit.mover!.target });
    stepSim(sim, hf, 1 / 30);
    squad.forEach((unit, i) => {
      if (!targets[i]) return;
      const target = targets[i]!;
      const next = unit.mover!.target;
      if (!next || next.x !== target.x || next.z !== target.z) {
        // Each waypoint is accepted inside the flight turn radius, in order.
        const nextPoint = path[visited[i] + 1];
        if (unit.mover!.tactic && nextPoint) expect(unit.mover!.target).toEqual(nextPoint);
        visited[i]++;
      }
    });
    stepCombat(sim, 1 / 30);
    sim.events.length = 0;
  }
  expect(visited).toEqual(squad.map(() => path.length));
  expect(enemy.health!.current).toBeLessThan(enemy.health!.max);
  expect(squad.some((unit) => unit.health!.current < unit.health!.max)).toBe(true);
});

it.each([0, 0.15, 0.9])('keeps tight group routes inside a proportional corridor at variation %s', (variation) => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const squad = Array.from({ length: 20 }, (_, i) => spawnVultureAt(sim, hf, -30, i - 10, `Corridor ${i}`, 1));
  const path = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 20, z: 10 }];
  issueTacticOrder(sim, squad, path, { kind: 'attack-through' }, true, variation);
  for (const unit of squad) {
    const points = [unit.mover!.target!, ...unit.mover!.tactic!.remaining];
    for (let i = 0; i < points.length - 1; i++) {
      expect(Math.hypot(points[i].x - path[i].x, points[i].z - path[i].z)).toBeLessThanOrEqual(1.5 * variation + 0.00001);
    }
  }
  for (let tick = 0; tick < 1800 && squad.some((u) => u.mover!.tactic); tick++) {
    const previous = squad.map((u) => ({ x: u.velocity!.x, z: u.velocity!.z }));
    stepSim(sim, hf, 1 / 30);
    squad.forEach((u, i) => {
      const a = previous[i];
      if (!u.mover!.tactic || Math.hypot(a.x, a.z) < 1 || Math.hypot(u.velocity!.x, u.velocity!.z) < 1) return;
      const delta = Math.atan2(u.velocity!.x, u.velocity!.z) - Math.atan2(a.x, a.z);
      expect(Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)))).toBeLessThan(3.4 / 30 + 0.00001);
    });
  }
  expect(squad.every((u) => !u.mover!.tactic)).toBe(true);
  for (let tick = 0; tick < 1800 && squad.some((u) => u.mover!.target); tick++) stepSim(sim, hf, 1 / 30);
  expect(new Set(squad.map((u) => `${u.transform.x},${u.transform.z}`)).size).toBe(squad.length);
});

it('parks fifty aircraft in separate stable slots after an exact shared route', () => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const squad = Array.from({ length: 50 }, (_, i) => spawnHammerheadAt(sim, hf, -100 - i % 10 * 12, Math.floor(i / 10) * 12, `Parking ${i}`, 1));
  issueTacticOrder(sim, squad, [{ x: -30, z: 0 }, { x: 60, z: 0 }], { kind: 'attack-through' }, true, 0);
  for (let i = 0; i < 30 * 90; i++) stepSim(sim, hf, 1 / 30);
  expect(squad.every((u) => !u.mover!.target && !u.mover!.tactic && !!u.mover!.holdPosition)).toBe(true);
  for (let i = 0; i < squad.length; i++) for (let j = i + 1; j < squad.length; j++) {
    expect(Math.hypot(squad[i].transform.x - squad[j].transform.x, squad[i].transform.z - squad[j].transform.z)).toBeGreaterThanOrEqual(9.5);
  }
  const positions = squad.map((u) => ({ x: u.transform.x, z: u.transform.z }));
  for (let i = 0; i < 300; i++) stepSim(sim, hf, 1 / 30);
  expect(squad.map((u) => ({ x: u.transform.x, z: u.transform.z }))).toEqual(positions);
});


describe('persistent aggressive stance', () => {
  it.each(['tank', 'infantry', 'aircraft'] as const)('fires throughout ordinary %s movement without stopping or chasing', (kind) => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    sim.rules.autoCombat = false;
    const unit = kind === 'aircraft' ? spawnVultureAt(sim, hf, 0, 0, 'Aggressor', 1) : kind === 'infantry' ? spawnInfantryAt(sim, 0, 0, 1, 'infantry') : spawnTankAt(sim, 0, 0, 'Aggressor', 1);
    const enemy = spawnTankAt(sim, 45, 20, 'Enemy', 2);
    unit.health!.current = unit.health!.max = 100000;
    enemy.health!.current = enemy.health!.max = 100000;
    enemy.weapon = { kind: kind === 'aircraft' ? 'aaMissile' : 'autocannon', range: 200, cooldown: 0 };
    enemy.weapons = undefined;
    enemy.mover!.attackMove = true;
    setAggressiveMode([unit], true);
    issueMoveOrder(sim, [unit], 120, 0);
    let firedWhileMoving = false;
    for (let tick = 0; tick < 1800 && unit.mover!.target; tick++) {
      stepSim(sim, hf, 1 / 30);
      const before = enemy.health!.current;
      stepCombat(sim, 1 / 30);
      firedWhileMoving ||= enemy.health!.current < before && !!unit.mover!.target;
      expect(unit.mover!.engage).toBeUndefined();
      if (unit.mover!.target) expect(unit.mover!.target).toEqual({ x: 120, z: 0 });
      sim.events.length = 0;
    }
    expect(firedWhileMoving).toBe(true);
    expect(unit.mover!.target).toBeUndefined();
    expect(Math.hypot(unit.transform.x - 120, unit.transform.z)).toBeLessThan(3);
    expect(unit.mover!.aggressive).toBe(true);
    const parked = { x: unit.transform.x, z: unit.transform.z };
    for (let tick = 0; tick < 90; tick++) { stepSim(sim, hf, 1 / 30); stepCombat(sim, 1 / 30); }
    expect(unit.mover!.engage).toBeUndefined();
    expect(Math.hypot(unit.transform.x - parked.x, unit.transform.z - parked.z)).toBeLessThan(3);
    setAggressiveMode([unit], false);
    expect(unit.mover!.aggressive).toBeUndefined();
  });

  it('persists across move, stop, save and restore, and affects the simulation hash', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const unit = spawnVultureAt(sim, hf, 0, 0, 'Stance', 1);
    const normal = hashSim(sim);
    setAggressiveMode([unit], true);
    expect(hashSim(sim)).not.toBe(normal);
    issueMoveOrder(sim, [unit], 30, 0);
    stopEntities([unit]);
    expect(unit.mover!.aggressive).toBe(true);
    const restored = loadSerializedSim(hf, serializeSim(sim));
    expect(restored.byId.get(unit.id)?.mover?.aggressive).toBe(true);
    setAggressiveMode([unit], false);
    issueMoveOrder(sim, [unit], 50, 0);
    expect(unit.mover!.aggressive).toBeUndefined();
  });
});

it.each([spawnWaspAt, spawnVultureAt, spawnHammerheadAt])('keeps fast-flight momentum through sharp corners and U-turns, then parks', (spawn) => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const aircraft = spawn(sim, hf, -160, 0, 'Fast route', 1);
  const speed = aircraft.mover!.speed * 1.65;
  aircraft.transform.rot = Math.PI / 2;
  aircraft.velocity!.x = speed;
  aircraft.velocity!.z = 0;
  const path = [{ x: -40, z: 0 }, { x: -40, z: 90 }, { x: -120, z: 90 }, { x: 80, z: 90 }, { x: 140, z: 0 }];
  issueTacticOrder(sim, [aircraft], path, { kind: 'attack-through' }, true, 0);
  let transitions = 0;
  for (let tick = 0; tick < 2400 && aircraft.mover!.tactic; tick++) {
    const remaining = aircraft.mover!.tactic.remaining.length;
    const previousHeading = Math.atan2(aircraft.velocity!.x, aircraft.velocity!.z);
    stepSim(sim, hf, 1 / 30);
    if ((aircraft.mover!.tactic?.remaining.length ?? 0) < remaining) transitions++;
    if (aircraft.mover!.tactic?.remaining.length) {
      expect(Math.hypot(aircraft.velocity!.x, aircraft.velocity!.z)).toBeGreaterThanOrEqual(speed * 0.64);
      const heading = Math.atan2(aircraft.velocity!.x, aircraft.velocity!.z);
      expect(Math.abs(Math.atan2(Math.sin(heading - previousHeading), Math.cos(heading - previousHeading)))).toBeLessThanOrEqual(3.4 / 30 + 0.00001);
    }
  }
  expect(transitions).toBe(path.length - 1);
  expect(aircraft.mover!.tactic).toBeUndefined();
  expect(aircraft.mover!.holdPosition).toEqual(path.at(-1));
  expect(Math.hypot(aircraft.velocity!.x, aircraft.velocity!.z)).toBe(0);
});
