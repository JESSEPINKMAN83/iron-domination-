import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
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
