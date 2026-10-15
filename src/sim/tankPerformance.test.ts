import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { createGameSim, spawnTankAt, spawnScoutTankAt, spawnSiegeTankAt } from './world';
import { manualFireAt, stepCombat } from './combat';

describe('current tank roster in V-mode', () => {
  for (const [name, spawn] of [['Jackal', spawnScoutTankAt], ['M-17', spawnTankAt], ['Mauler', spawnSiegeTankAt]] as const) {
    for (const distance of [12, 60]) {
      it(`${name} hits an aimed enemy at ${distance} metres`, () => {
        const sim = createGameSim(generateHeightfield(MAP01));
        const tank = spawn(sim, 0, 0, name);
        const target = spawnTankAt(sim, distance, 0, 'Target', 2);
        tank.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
        tank.turret!.yaw = Math.PI / 2;
        const before = target.health!.current;
        expect(manualFireAt(sim, tank, distance, 0)).toBe(true);
        if (name === 'Mauler') expect(sim.projectiles[0].trajectory).toBe('flat');
        for (let tick = 0; tick < 60; tick++) stepCombat(sim, 1 / 30, { autoFire: false });
        expect(target.health!.current).toBeLessThan(before);
      });
    }
  }

  it('Mauler destroys a standard tank with two aimed primary shells', () => {
    const sim = createGameSim(generateHeightfield(MAP01));
    const tank = spawnSiegeTankAt(sim, 0, 0, 'Mauler');
    const target = spawnTankAt(sim, 60, 0, 'Target', 2);
    tank.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    tank.turret!.yaw = Math.PI / 2;
    for (let shot = 0; shot < 2; shot++) {
      expect(manualFireAt(sim, tank, target.transform.x, target.transform.z)).toBe(true);
      for (let tick = 0; tick < 120; tick++) stepCombat(sim, 1 / 30, { autoFire: false });
    }
    expect(target.health!.current).toBeLessThanOrEqual(0);
  });
});

it('gives a near-reticle ground target modest aim forgiveness in V-mode', () => {
  const sim = createGameSim(generateHeightfield(MAP01));
  const tank = spawnTankAt(sim, 0, 0, 'Player');
  const target = spawnTankAt(sim, 60, 0, 'Target', 2);
  target.transform.z = (target.collider?.radius ?? 2.4) * 0.82 + 0.6;
  tank.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
  tank.turret!.yaw = Math.PI / 2;
  const before = target.health!.current;
  expect(manualFireAt(sim, tank, 80, 0)).toBe(true);
  for (let i = 0; i < 90; i++) stepCombat(sim, 1 / 30, { autoFire: false });
  expect(target.health!.current).toBeLessThan(before);
});

it('Mauler secondary locks and guides a missile onto an enemy tank', () => {
  const sim = createGameSim(generateHeightfield(MAP01));
  const tank = spawnSiegeTankAt(sim, 0, 0, 'Mauler');
  const target = spawnTankAt(sim, 60, 0, 'Target', 2);
  tank.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
  tank.turret!.yaw = Math.PI / 2;
  expect(tank.weapons!.secondary!.kind).toBe('siegeMissile');
  const before = target.health!.current;
  expect(manualFireAt(sim, tank, 60, 0, 'secondary', undefined, target.id)).toBe(true);
  expect(sim.projectiles[0].trajectory).toBe('homing');
  for (let i = 0; i < 150; i++) stepCombat(sim, 1 / 30, { autoFire: false });
  expect(target.health!.current).toBeLessThan(before);
});
