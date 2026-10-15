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
