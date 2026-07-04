import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { damageForArmor, manualFireAt, stepCombat } from './combat';
import { generateHeightfield } from './heightfield';
import { createGameSim, hashSim, spawnTankAt } from './world';

describe('phase 4 combat simulation', () => {
  it('applies weapon damage matrix values', () => {
    expect(damageForArmor('rifle', 'heavy')).toBeCloseTo(2.2);
    expect(damageForArmor('cannon', 'heavy')).toBeCloseTo(5.76);
    expect(damageForArmor('bomb', 'heavy')).toBeCloseTo(24.48);
    expect(damageForArmor('bomb', 'building')).toBeCloseTo(15.3);
  });

  it('resolves a deterministic tank engagement and records combat events', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const a = spawnTankAt(sim, -20, -20, 'A');
      const b = spawnTankAt(sim, 18, -20, 'B', 2);
      for (let i = 0; i < 30 * 8; i++) stepCombat(sim, 1 / 30);
      return { sim, aHp: a.health?.current ?? 0, bHp: b.health?.current ?? 0, events: sim.events.length, hash: hashSim(sim) };
    };

    const first = run();
    const second = run();
    expect(first.hash).toBe(second.hash);
    expect(first.events).toBeGreaterThan(0);
    expect(first.aHp).toBeLessThan(100);
    expect(first.bHp).toBeLessThan(100);
  });

  it('lets a player-controlled tank fire manually through weapon data', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    const target = spawnTankAt(sim, 18, -20, 'B', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, 42, -20);

    expect(fired).toBe(true);
    expect(target.health?.current).toBeLessThan(100);
    expect(attacker.weapons?.primary.cooldown).toBeGreaterThan(0);
    expect(sim.events).toHaveLength(1);
    expect(sim.events[0].damage).toBeGreaterThan(0);
  });

  it('lets a player-controlled tank fire a slower heavy bomb with splash', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    const primary = spawnTankAt(sim, 18, -20, 'B', 2);
    const nearby = spawnTankAt(sim, 22, -20, 'C', 2);
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, primary.transform.x, primary.transform.z, 'secondary');
    const firedAgain = manualFireAt(sim, attacker, primary.transform.x, primary.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(firedAgain).toBe(false);
    expect(primary.health?.current).toBeLessThan(100);
    expect(nearby.health?.current).toBeLessThan(100);
    expect(nearby.health?.current).toBeGreaterThan(70);
    expect(attacker.weapons?.secondary?.cooldown).toBeGreaterThan(attacker.weapons?.primary.cooldown ?? 0);
    expect(sim.events.at(-1)?.kind).toBe('bomb');
  });

  it('lets player-controlled bombs fire beyond normal range with deterministic scatter', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, 360, -20, 'secondary');

    expect(fired).toBe(true);
    expect(sim.events).toHaveLength(1);
    expect(Math.hypot(sim.events[0].toX - attacker.transform.x, sim.events[0].toZ - attacker.transform.z)).toBeGreaterThan(152);
    expect(sim.events[0].toX).not.toBeCloseTo(360);
    expect(sim.events[0].kind).toBe('bomb');
  });

  it('keeps a manually fired bomb safely away from the firing tank', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attacker = spawnTankAt(sim, -20, -20, 'A');
    attacker.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };

    const fired = manualFireAt(sim, attacker, attacker.transform.x, attacker.transform.z, 'secondary');

    expect(fired).toBe(true);
    expect(attacker.health?.current).toBe(100);
    expect(Math.hypot(sim.events[0].toX - attacker.transform.x, sim.events[0].toZ - attacker.transform.z)).toBeGreaterThan(40);
  });

  it('prevents AI siege bombs from targeting the possessed tank', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const player = spawnTankAt(sim, -20, -20, 'A');
    const enemy = spawnTankAt(sim, -20, 35, 'B', 2);
    player.playerControlled = { throttle: 0, turn: 0, aimYaw: 0 };
    enemy.weapons!.primary.cooldown = 99;

    stepCombat(sim, 1 / 30);

    expect(sim.events.some((event) => event.kind === 'bomb')).toBe(false);
    expect(player.health?.current).toBe(100);
    expect(enemy.weapons?.secondary?.cooldown).toBe(0);
  });
});
