import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { FlowField } from './flowfield';
import { generateHeightfield, sampleHeight } from './heightfield';
import { createGameSim, hashSim, issueMoveOrder, spawnDebugTanks, spawnVultureAt, stepSim } from './world';

describe('phase 2 movement simulation', () => {
  it('builds a flow field between distant walkable cells', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const start = sim.nav.nearestWalkableCell(-hf.size * 0.33, -hf.size * 0.28);
    const end = sim.nav.nearestWalkableCell(hf.size * 0.34, hf.size * 0.26);
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    const target = sim.nav.cellCenter(end!.x, end!.y);
    const flow = new FlowField(sim.nav, target.x, target.z);
    const origin = sim.nav.cellCenter(start!.x, start!.y);
    const dir = flow.directionAt(origin.x, origin.z);
    expect(dir.distance).toBeGreaterThan(0);
    expect(Math.hypot(dir.x, dir.z)).toBeGreaterThan(0.5);
  });

  it('moves 120 tanks deterministically for 10k ticks', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const tanks = spawnDebugTanks(sim, hf, 120);
      const target = sim.nav.nearestWalkableCell(hf.size * 0.34, hf.size * 0.26);
      expect(target).toBeDefined();
      const p = sim.nav.cellCenter(target!.x, target!.y);
      expect(issueMoveOrder(sim, tanks, p.x, p.z)).toBe(true);
      for (let i = 0; i < 10000; i++) stepSim(sim, hf, 1 / 30);
      return { sim, tanks, hash: hashSim(sim) };
    };

    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    const reached = a.tanks.filter((tank) => {
      if (!tank.mover?.target) return true;
      const dx = tank.transform.x - tank.mover.target.x;
      const dz = tank.transform.z - tank.mover.target.z;
      return Math.hypot(dx, dz) < 55;
    }).length;
    expect(reached).toBeGreaterThan(100);
  });

  it('moves a player-controlled tank through the same sim step', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const [tank] = spawnDebugTanks(sim, hf, 1);
    const start = { x: tank.transform.x, z: tank.transform.z };
    tank.playerControlled = { throttle: 1, turn: 0, aimYaw: tank.transform.rot };

    for (let i = 0; i < 90; i++) stepSim(sim, hf, 1 / 30);

    expect(Math.hypot(tank.transform.x - start.x, tank.transform.z - start.z)).toBeGreaterThan(8);
    expect(tank.mover?.target).toBeUndefined();
    expect(tank.mover?.flow).toBeUndefined();
  });

  it('seeds deterministic finite oil nodes from map ore fields', () => {
    const aHf = generateHeightfield(MAP01);
    const bHf = generateHeightfield(MAP01);
    const a = createGameSim(aHf);
    const b = createGameSim(bHf);

    expect(a.resourceNodes).toHaveLength(aHf.oreFields.length);
    expect(a.resourceNodes.length).toBeGreaterThan(0);
    expect(a.resourceNodes).toEqual(b.resourceNodes);
    expect(hashSim(a)).toBe(hashSim(b));
    expect(
      a.resourceNodes.every((node, index) => {
        const field = aHf.oreFields[index];
        return (
          node.id === index + 1 &&
          node.kind === 'oil' &&
          node.x === field.x &&
          node.z === field.z &&
          node.radius === field.radius &&
          node.capacity > 0 &&
          node.remaining === node.capacity
        );
      }),
    ).toBe(true);
  });

  it('snaps ground move orders from blocked clicks to a nearby walkable cell', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tanks = spawnDebugTanks(sim, hf, 2);
    let blocked: { x: number; z: number } | undefined;
    for (let y = 0; y < hf.cells && !blocked; y++) {
      for (let x = 0; x < hf.cells; x++) {
        if (hf.walkable[y * hf.cells + x] > 0) continue;
        const p = sim.nav.cellCenter(x, y);
        if (sim.nav.nearestWalkableCell(p.x, p.z, 96)) {
          blocked = p;
          break;
        }
      }
    }
    expect(blocked).toBeDefined();

    expect(issueMoveOrder(sim, tanks, blocked!.x, blocked!.z)).toBe(true);

    expect(tanks.every((tank) => tank.mover?.target && tank.mover.flow)).toBe(true);
  });

  it('honors right-drag style move orders with a final facing direction and line formation', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tanks = spawnDebugTanks(sim, hf, 4);
    const target = sim.nav.nearestWalkableCell(tanks[0].transform.x + 36, tanks[0].transform.z + 12, 96);
    expect(target).toBeDefined();
    const p = sim.nav.cellCenter(target!.x, target!.y);
    const faceYaw = Math.PI / 2;

    expect(issueMoveOrder(sim, tanks, p.x, p.z, false, faceYaw)).toBe(true);

    const offsets = tanks.map((tank) => tank.mover?.formationOffset);
    expect(offsets.every(Boolean)).toBe(true);
    const spanX = Math.max(...offsets.map((offset) => offset!.x)) - Math.min(...offsets.map((offset) => offset!.x));
    const spanZ = Math.max(...offsets.map((offset) => offset!.z)) - Math.min(...offsets.map((offset) => offset!.z));
    expect(spanZ).toBeGreaterThan(spanX);

    for (let i = 0; i < 30 * 12; i++) stepSim(sim, hf, 1 / 30);

    expect(tanks.some((tank) => Math.abs(angleDelta(tank.transform.rot, faceYaw)) < 0.2)).toBe(true);
    expect(tanks.every((tank) => tank.mover?.faceYaw === faceYaw)).toBe(true);
  });

  it('moves flyers directly over blocked terrain while maintaining altitude', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -hf.size * 0.3, -hf.size * 0.2, 'Vulture 1');
    const start = { x: vulture.transform.x, z: vulture.transform.z };
    expect(issueMoveOrder(sim, [vulture], hf.size * 0.3, hf.size * 0.22)).toBe(true);

    for (let i = 0; i < 30 * 8; i++) stepSim(sim, hf, 1 / 30);

    expect(Math.hypot(vulture.transform.x - start.x, vulture.transform.z - start.z)).toBeGreaterThan(120);
    expect(vulture.mover?.flow).toBeUndefined();
    expect((vulture.transform.y ?? 0) - sampleHeight(hf, vulture.transform.x, vulture.transform.z)).toBeGreaterThanOrEqual(vulture.flight!.minAGL - 0.1);
  });

  it('lets a player-controlled flyer steer forward and climb in the sim', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -hf.size * 0.08, -hf.size * 0.08, 'Vulture 1');
    const start = { x: vulture.transform.x, y: vulture.transform.y ?? 0, z: vulture.transform.z };
    vulture.playerControlled = { throttle: 1, turn: 0, aimYaw: Math.PI * 0.25, climb: 1 };

    for (let i = 0; i < 90; i++) stepSim(sim, hf, 1 / 30);

    expect(Math.hypot(vulture.transform.x - start.x, vulture.transform.z - start.z)).toBeGreaterThan(30);
    expect((vulture.transform.y ?? 0) - start.y).toBeGreaterThan(4);
    expect(vulture.mover?.target).toBeUndefined();
    expect(vulture.mover?.flow).toBeUndefined();
  });

  it('keeps a reversing player-controlled flyer facing its aim direction', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -hf.size * 0.08, -hf.size * 0.08, 'Vulture 1');
    const start = { x: vulture.transform.x, z: vulture.transform.z, rot: vulture.transform.rot };
    vulture.playerControlled = { throttle: -1, turn: 0, aimYaw: start.rot, climb: 0 };

    for (let i = 0; i < 90; i++) stepSim(sim, hf, 1 / 30);

    const backwardX = vulture.transform.x - start.x;
    const backwardZ = vulture.transform.z - start.z;
    const forwardDot = backwardX * Math.sin(start.rot) + backwardZ * Math.cos(start.rot);
    expect(forwardDot).toBeLessThan(-8);
    expect(Math.abs(angleDelta(vulture.transform.rot, start.rot))).toBeLessThan(0.12);
  });
});

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
