import { issueTacticOrder } from './tactics';
import { expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { createGameSim, stepSim } from './world';
import { spawnInfantryAt } from './economy';

function drive(throttle: number, strafe: number) {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const soldier = spawnInfantryAt(sim, 0, 0, 1, 'infantry');
  soldier.playerControlled = { throttle, strafe, turn: 0, aimYaw: 0 };
  for (let i = 0; i < 15; i++) stepSim(sim, hf, 1 / 30);
  return soldier;
}
it('strafes sideways while keeping the infantry weapon facing the aim direction', () => {
  const soldier = drive(0, 1);
  expect(soldier.velocity!.x).toBeGreaterThan(1);
  expect(Math.abs(soldier.velocity!.z)).toBeLessThan(0.1);
  expect(soldier.transform.rot).toBe(0);
});
it('normalizes diagonal infantry movement to the same speed as forward movement', () => {
  const straight = drive(1, 0);
  const diagonal = drive(1, 1);
  expect(Math.hypot(diagonal.velocity!.x, diagonal.velocity!.z)).toBeCloseTo(Math.hypot(straight.velocity!.x, straight.velocity!.z), 1);
});

it('jumps once per press, lands, and crouches at reduced movement speed', () => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const soldier = spawnInfantryAt(sim, 0, 0, 1, 'infantry');
  soldier.playerControlled = { throttle: 0, turn: 0, aimYaw: 0, climb: 1 };
  for (let i = 0; i < 8; i++) stepSim(sim, hf, 1 / 30);
  expect(soldier.infantryStance!.height).toBeGreaterThan(0.5);
  for (let i = 0; i < 45; i++) stepSim(sim, hf, 1 / 30);
  expect(soldier.infantryStance!.height).toBe(0);
  soldier.playerControlled.climb = -1;
  soldier.playerControlled.throttle = 1;
  for (let i = 0; i < 15; i++) stepSim(sim, hf, 1 / 30);
  expect(soldier.infantryStance!.crouch).toBeCloseTo(0.65);
  expect(Math.hypot(soldier.velocity!.x, soldier.velocity!.z)).toBeLessThanOrEqual(soldier.mover!.speed * 0.51);
  soldier.playerControlled.climb = 1;
  stepSim(sim, hf, 1 / 30);
  expect(soldier.infantryStance!.height).toBeGreaterThan(0);
});

it('lets a bike jump, rotate through a full flip and land above terrain', () => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const rider = spawnInfantryAt(sim, 0, 0, 1, 'infantry');
  rider.unitUpgrades = { ids: ['combat-bike'] };
  rider.playerControlled = { throttle: 0, turn: 0, strafe: 1, climb: 1, aimYaw: 0 };
  let maximumHeight = 0;
  let maximumPitch = 0;
  for (let i = 0; i < 40; i++) {
    stepSim(sim, hf, 1 / 30);
    maximumHeight = Math.max(maximumHeight, rider.infantryStance?.height ?? 0);
    maximumPitch = Math.max(maximumPitch, Math.abs(rider.infantryStance?.bikePitch ?? 0));
  }
  expect(maximumHeight).toBeGreaterThan(2);
  expect(maximumPitch).toBeGreaterThan(Math.PI * 2);
  for (let i = 0; i < 60; i++) stepSim(sim, hf, 1 / 30);
  expect(rider.infantryStance?.height).toBe(0);
  expect(Math.abs(rider.infantryStance?.bikePitch ?? 0)).toBeLessThan(0.01);
});

it('preserves bike momentum after throttle release in midair and completes the jump', () => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const rider = spawnInfantryAt(sim, 0, 0, 1, 'infantry');
  rider.unitUpgrades = { ids: ['combat-bike'] };
  rider.playerControlled = { throttle: 1, turn: 0, strafe: 0, climb: 0, aimYaw: 0 };
  for (let i = 0; i < 30; i++) stepSim(sim, hf, 1 / 30);
  rider.playerControlled.climb = 1;
  for (let i = 0; i < 5; i++) stepSim(sim, hf, 1 / 30);
  const speed = Math.hypot(rider.velocity!.x, rider.velocity!.z);
  rider.playerControlled.throttle = 0;
  rider.playerControlled.climb = 0;
  for (let i = 0; i < 10; i++) stepSim(sim, hf, 1 / 30);
  expect(Math.hypot(rider.velocity!.x, rider.velocity!.z)).toBeGreaterThan(speed * 0.65);
  for (let i = 0; i < 100; i++) stepSim(sim, hf, 1 / 30);
  expect(rider.infantryStance?.height).toBe(0);
  expect(rider.infantryStance?.velocity).toBe(0);
});

it('finishes a straight high-speed bike tactic without circling its waypoints', () => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const rider = spawnInfantryAt(sim, 0, 0, 1, 'infantry');
  rider.unitUpgrades = { ids: ['combat-bike'] };
  rider.mover!.speed = 35;
  issueTacticOrder(sim, [rider], [{ x: 0, z: 12 }, { x: 0, z: 24 }, { x: 0, z: 40 }], { kind: 'attack-through' });
  let reversals = 0;
  for (let i = 0; i < 300 && rider.mover!.tactic; i++) {
    stepSim(sim, hf, 1 / 30);
    if (rider.velocity!.z < -1) reversals++;
  }
  expect(rider.mover!.tactic).toBeUndefined();
  expect(reversals).toBeLessThan(3);
});
