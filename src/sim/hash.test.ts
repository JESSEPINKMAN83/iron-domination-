import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { createEconomy, createInitialBase, hashEconomy } from './economy';
import { generateHeightfield } from './heightfield';
import { createGameSim, hashCriticalSimState, hashSim, spawnTankAt, spawnVultureAt } from './world';

// hashSim is the determinism canary (save/load + future multiplayer). These tests
// assert it actually reacts to each tracked field — a hash that ignores a field can't
// catch a desync in it.
describe('hashSim sensitivity', () => {
  const fresh = () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    return { hf, sim };
  };

  it('reacts to position, rotation and velocity', () => {
    const { sim } = fresh();
    const tank = spawnTankAt(sim, 0, 0, 'A');
    const base = hashSim(sim);
    tank.transform.x += 0.5;
    expect(hashSim(sim)).not.toBe(base);
    const h1 = hashSim(sim);
    tank.transform.rot += 0.01;
    expect(hashSim(sim)).not.toBe(h1);
    const h2 = hashSim(sim);
    if (tank.velocity) tank.velocity.x += 1;
    expect(hashSim(sim)).not.toBe(h2);
    const h3 = hashSim(sim);
    if (tank.mover) tank.mover.yawRate = 0.25;
    expect(hashSim(sim)).not.toBe(h3);
    const h4 = hashSim(sim);
    if (tank.mover) tank.mover.turnaround = { targetYaw: Math.PI, direction: 1 };
    expect(hashSim(sim)).not.toBe(h4);
  });

  it('reacts to turret yaw and weapon cooldown/target', () => {
    const { sim } = fresh();
    const tank = spawnTankAt(sim, 0, 0, 'A');
    const base = hashSim(sim);
    if (tank.turret) tank.turret.yaw += 0.2;
    expect(hashSim(sim)).not.toBe(base);
    const h1 = hashSim(sim);
    if (tank.weapons?.primary) tank.weapons.primary.cooldown = 1.5;
    expect(hashSim(sim)).not.toBe(h1);
    const h2 = hashSim(sim);
    if (tank.weapons?.primary) tank.weapons.primary.targetId = 42;
    expect(hashSim(sim)).not.toBe(h2);
  });

  it('reacts to health and flight attitude', () => {
    const { sim, hf } = fresh();
    const vulture = spawnVultureAt(sim, hf, 0, 0, 'V');
    const base = hashSim(sim);
    if (vulture.health) vulture.health.current -= 10;
    expect(hashSim(sim)).not.toBe(base);
    const h1 = hashSim(sim);
    if (vulture.flight) vulture.flight.pitchAttitude += 0.05;
    expect(hashSim(sim)).not.toBe(h1);
  });

  it('distinguishes equal-length harvester states (regression: was hashed by length)', () => {
    const { sim } = fresh();
    const tank = spawnTankAt(sim, 0, 0, 'A');
    // both 'seeking' and 'to-node' are length 7 — the old length-based hash collided
    tank.harvester = { state: 'seeking', timer: 0 };
    const seeking = hashSim(sim);
    tank.harvester.state = 'to-node';
    expect(hashSim(sim)).not.toBe(seeking);
  });

  it('reacts to building construction and producer progress', () => {
    const { sim, hf } = fresh();
    const economy = createEconomy(1);
    const base = createInitialBase(sim, hf, economy);
    const initial = hashSim(sim);
    base.building!.buildProgress = 0.5;
    base.building!.complete = false;
    expect(hashSim(sim)).not.toBe(initial);

    const constructing = hashSim(sim);
    base.producer!.queue.push({ kind: 'tank', label: 'Tank', remaining: 4, total: 8, cost: 800 });
    expect(hashSim(sim)).not.toBe(constructing);
  });

  it('reacts to economy and production-line progress', () => {
    const economy = createEconomy(1);
    const initial = hashEconomy(economy);
    economy.credits -= 100;
    expect(hashEconomy(economy)).not.toBe(initial);

    const spent = hashEconomy(economy);
    economy.structureLine = { kind: 'power-plant', label: 'Power Plant', remaining: 5, total: 10, cost: 500 };
    expect(hashEconomy(economy)).not.toBe(spent);

    const regularLine = hashEconomy(economy);
    economy.defenseStructureLine = { kind: 'guard-tower', label: 'Fortress Guard Tower', remaining: 3, total: 6, cost: 760 };
    expect(hashEconomy(economy)).not.toBe(regularLine);
  });
});

describe('critical multiplayer hash', () => {
  it('ignores harmless movement drift but catches health and death disagreements', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, 0, 0, 'A');
    const base = hashCriticalSimState(sim);
    tank.transform.x += 0.75;
    tank.transform.rot += 0.1;
    expect(hashCriticalSimState(sim)).toBe(base);
    tank.health!.current -= 10;
    expect(hashCriticalSimState(sim)).not.toBe(base);
    const damaged = hashCriticalSimState(sim);
    tank.destroyed = { remaining: 20 };
    expect(hashCriticalSimState(sim)).not.toBe(damaged);
  });
});
