import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { FlowField } from './flowfield';
import { generateHeightfield, sampleHeight, type Heightfield } from './heightfield';
import { createEconomy, createInitialBase } from './economy';
import { attackStandoffPoint, createGameSim, hashSim, issueMoveOrder, selectedEntities, setSelected, spawnDebugTanks, spawnTankAt, spawnVultureAt, stepSim } from './world';

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

  it('does not turn an idle tank to face passive blast momentum', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const [tank] = spawnDebugTanks(sim, hf, 1);
    const start = { x: tank.transform.x, z: tank.transform.z, rot: 1.17 };
    tank.transform.rot = start.rot;
    tank.previousTransform.rot = start.rot;
    tank.velocity!.x = 9;
    tank.velocity!.z = -4;

    stepSim(sim, hf, 1 / 30);

    expect(Math.hypot(tank.transform.x - start.x, tank.transform.z - start.z)).toBeGreaterThan(0.05);
    expect(tank.transform.rot).toBeCloseTo(start.rot);
  });

  it('doubles possessed ground unit movement while boost is held', () => {
    const run = (boost: boolean) => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const [tank] = spawnDebugTanks(sim, hf, 1);
      const start = { x: tank.transform.x, z: tank.transform.z };
      tank.playerControlled = { throttle: 1, turn: 0, aimYaw: tank.transform.rot, boost };

      for (let i = 0; i < 60; i++) stepSim(sim, hf, 1 / 30);

      return Math.hypot(tank.transform.x - start.x, tank.transform.z - start.z);
    };

    const normalDistance = run(false);
    const boostedDistance = run(true);

    expect(boostedDistance).toBeGreaterThan(normalDistance * 1.7);
  });

  it('lets boosted V-mode tanks force-climb dry terrain bumps that normal driving cannot pass', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const bump = findBoostableDryBump(hf, sim);
    expect(bump).toBeDefined();

    const run = (boost: boolean) => {
      const localSim = createGameSim(hf);
      const tank = spawnTankAt(localSim, bump!.start.x, bump!.start.z, boost ? 'Boost climber' : 'Normal driver');
      tank.transform.x = bump!.start.x;
      tank.transform.z = bump!.start.z;
      tank.transform.rot = Math.atan2(bump!.target.x - bump!.start.x, bump!.target.z - bump!.start.z);
      tank.previousTransform = { ...tank.transform };
      tank.playerControlled = { throttle: 1, turn: 0, aimYaw: tank.transform.rot, boost };
      let enteredDryBlockedTerrain = false;
      for (let i = 0; i < 42; i++) {
        stepSim(localSim, hf, 1 / 30);
        const cell = localSim.nav.worldToCell(tank.transform.x, tank.transform.z);
        const idx = localSim.nav.index(cell.x, cell.y);
        const dry = sampleHeight(hf, tank.transform.x, tank.transform.z) >= hf.waterLevel + 0.55;
        enteredDryBlockedTerrain ||= hf.walkable[idx] === 0 && dry;
      }
      return enteredDryBlockedTerrain;
    };

    expect(run(false)).toBe(false);
    expect(run(true)).toBe(true);
  });

  it('refuses enemy entities in player selection commands', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const [friendly] = spawnDebugTanks(sim, hf, 1);
    const enemy = spawnTankAt(sim, friendly.transform.x + 10, friendly.transform.z, 'Enemy Tank', 2);

    setSelected(sim, [friendly, enemy]);

    expect(selectedEntities(sim)).toEqual([friendly]);
    expect(friendly.selectable?.selected).toBe(true);
    expect(enemy.selectable?.selected).toBe(false);

    enemy.selectable!.selected = true;
    setSelected(sim, [enemy], true);

    expect(selectedEntities(sim)).toEqual([friendly]);
    expect(enemy.selectable?.selected).toBe(false);
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
          node.capacity === Math.round(field.radius * field.radius * 15) &&
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

  it('keeps exact walkable click positions instead of snapping every order to cell centers', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const [tank] = spawnDebugTanks(sim, hf, 1);
    const cell = sim.nav.nearestWalkableCell(tank.transform.x + 34, tank.transform.z + 18, 96);
    expect(cell).toBeDefined();
    const center = sim.nav.cellCenter(cell!.x, cell!.y);
    const target = { x: center.x + hf.cellSize * 0.29, z: center.z - hf.cellSize * 0.21 };
    expect(sim.nav.isWalkableCell(sim.nav.worldToCell(target.x, target.z).x, sim.nav.worldToCell(target.x, target.z).y)).toBe(true);

    expect(issueMoveOrder(sim, [tank], target.x, target.z)).toBe(true);

    expect(tank.mover?.target?.x).toBeCloseTo(target.x);
    expect(tank.mover?.target?.z).toBeCloseTo(target.z);
    expect(Math.hypot(target.x - center.x, target.z - center.z)).toBeGreaterThan(0.5);
  });

  it('does not clear close move orders until the unit reaches the requested point', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const [tank] = spawnDebugTanks(sim, hf, 1);
    const cell = sim.nav.nearestWalkableCell(tank.transform.x + 28, tank.transform.z, 96);
    expect(cell).toBeDefined();
    const target = sim.nav.cellCenter(cell!.x, cell!.y);
    const startDistance = Math.hypot(target.x - tank.transform.x, target.z - tank.transform.z);
    expect(startDistance).toBeGreaterThan(12);
    expect(startDistance).toBeLessThan(42);

    expect(issueMoveOrder(sim, [tank], target.x, target.z)).toBe(true);
    stepSim(sim, hf, 1 / 30);

    expect(tank.mover?.target).toBeDefined();
    for (let i = 0; i < 30 * 7; i++) stepSim(sim, hf, 1 / 30);
    expect(tank.mover?.target).toBeUndefined();
    expect(Math.hypot(target.x - tank.transform.x, target.z - tank.transform.z)).toBeLessThan(3.2);
  });

  it('keeps direct attack orders outside a building footprint', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const attackers = [
      spawnTankAt(sim, -78, -20, 'Attacker A', 1),
      spawnTankAt(sim, -82, -26, 'Attacker B', 1),
      spawnTankAt(sim, -74, -30, 'Attacker C', 1),
    ];
    const target = createInitialBase(sim, hf, createEconomy(2, 4600), 0, -20);

    const point = attackStandoffPoint(sim, attackers, target);
    expect(issueMoveOrder(sim, attackers, point.x, point.z, true)).toBe(true);

    const distanceToBuildingCenter = Math.hypot(point.x - target.transform.x, point.z - target.transform.z);
    expect(distanceToBuildingCenter).toBeGreaterThan((target.collider?.radius ?? 0) + 10);
    expect(distanceToBuildingCenter).toBeLessThan(attackers[0].weapons!.primary.range);
    expect(attackers.every((tank) => tank.mover?.target && tank.mover.attackMove)).toBe(true);
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

  it('uses right-drag distance to spread selected units into a wider facing line', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tanks = spawnDebugTanks(sim, hf, 6);
    const target = sim.nav.nearestWalkableCell(tanks[0].transform.x + 36, tanks[0].transform.z + 12, 96);
    expect(target).toBeDefined();
    const p = sim.nav.cellCenter(target!.x, target!.y);
    const faceYaw = Math.PI / 2;

    expect(issueMoveOrder(sim, tanks, p.x, p.z, false, faceYaw, 18)).toBe(true);
    const tightOffsets = tanks.map((tank) => tank.mover?.formationOffset);
    const tightSpan = Math.max(...tightOffsets.map((offset) => offset!.z)) - Math.min(...tightOffsets.map((offset) => offset!.z));

    expect(issueMoveOrder(sim, tanks, p.x, p.z, false, faceYaw, 72)).toBe(true);
    const wideOffsets = tanks.map((tank) => tank.mover?.formationOffset);
    const wideSpanZ = Math.max(...wideOffsets.map((offset) => offset!.z)) - Math.min(...wideOffsets.map((offset) => offset!.z));
    const wideSpanX = Math.max(...wideOffsets.map((offset) => offset!.x)) - Math.min(...wideOffsets.map((offset) => offset!.x));

    expect(wideSpanZ).toBeGreaterThan(tightSpan * 1.7);
    expect(wideSpanX).toBeLessThan(0.001);
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

  it('doubles possessed aircraft movement and climb while boost is held', () => {
    const run = (boost: boolean) => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const vulture = spawnVultureAt(sim, hf, -hf.size * 0.08, -hf.size * 0.08, 'Vulture 1');
      const start = { x: vulture.transform.x, y: vulture.transform.y ?? 0, z: vulture.transform.z };
      vulture.playerControlled = { throttle: 1, turn: 0, aimYaw: vulture.transform.rot, climb: 1, strafe: 0, boost };

      for (let i = 0; i < 34; i++) stepSim(sim, hf, 1 / 30);

      return {
        distance: Math.hypot(vulture.transform.x - start.x, vulture.transform.z - start.z),
        climb: (vulture.transform.y ?? 0) - start.y,
      };
    };

    const normal = run(false);
    const boosted = run(true);

    expect(boosted.distance).toBeGreaterThan(normal.distance * 1.45);
    expect(boosted.climb).toBeGreaterThan(normal.climb * 1.35);
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

  it('lets a player-controlled gunship make a fast 180-degree turn at speed', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -hf.size * 0.08, -hf.size * 0.08, 'Vulture 1');
    const startYaw = vulture.transform.rot;
    vulture.playerControlled = { throttle: 1, turn: 0, aimYaw: startYaw, climb: 0, strafe: 0 };

    for (let i = 0; i < 30 * 4; i++) stepSim(sim, hf, 1 / 30);

    expect(vulture.velocity ? Math.hypot(vulture.velocity.x, vulture.velocity.z) : 0).toBeGreaterThan(12);
    const reverseYaw = startYaw + Math.PI;
    vulture.playerControlled.aimYaw = reverseYaw;

    for (let i = 0; i < 30 * 1.35; i++) stepSim(sim, hf, 1 / 30);

    expect(Math.abs(angleDelta(vulture.transform.rot, reverseYaw))).toBeLessThan(0.52);
    expect(vulture.destroyed).toBeUndefined();
  });

  it('accepts unbounded player aim yaw for continuous 360-degree V-mode turns', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const vulture = spawnVultureAt(sim, hf, -hf.size * 0.08, -hf.size * 0.08, 'Vulture 1');
    vulture.playerControlled = { throttle: 0.25, turn: 0, aimYaw: vulture.transform.rot, climb: 0, strafe: 0 };

    for (let i = 0; i < 30 * 7; i++) {
      vulture.playerControlled.aimYaw += 0.055;
      stepSim(sim, hf, 1 / 30);
    }

    expect(vulture.playerControlled.aimYaw).toBeGreaterThan(Math.PI * 2);
    expect(Number.isFinite(vulture.transform.rot)).toBe(true);
    expect(Math.abs(vulture.transform.rot)).toBeLessThanOrEqual(Math.PI + 0.001);
    expect(Math.abs(angleDelta(vulture.transform.rot, vulture.playerControlled.aimYaw))).toBeLessThan(0.75);
    expect(vulture.destroyed).toBeUndefined();
  });

  it('honors hard-turn flight input above normal yaw trim', () => {
    const run = (turn: number) => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const vulture = spawnVultureAt(sim, hf, -hf.size * 0.08, -hf.size * 0.08, 'Vulture 1');
      const startYaw = vulture.transform.rot;
      vulture.playerControlled = { throttle: 0, turn, aimYaw: startYaw, climb: 0, strafe: 0 };
      for (let i = 0; i < 12; i++) stepSim(sim, hf, 1 / 30);
      return Math.abs(angleDelta(vulture.transform.rot, startYaw));
    };

    const normalTurn = run(-1);
    const hardTurn = run(-1.55);

    expect(hardTurn).toBeGreaterThan(normalTurn * 1.35);
  });

  it('integrates possessed gunship flight deterministically with strafe and attitude', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const vulture = spawnVultureAt(sim, hf, -hf.size * 0.04, -hf.size * 0.06, 'Vulture 1');
      const start = { x: vulture.transform.x, z: vulture.transform.z };
      vulture.playerControlled = { throttle: 0, turn: 0, strafe: 0, aimYaw: vulture.transform.rot, climb: 0 };
      for (let i = 0; i < 600; i++) {
        const controlled = vulture.playerControlled!;
        controlled.throttle = i < 190 ? 1 : i < 300 ? 0.15 : i < 390 ? -1 : 0;
        controlled.turn = i >= 120 && i < 255 ? -0.65 : i >= 410 && i < 500 ? 0.45 : 0;
        controlled.strafe = i >= 260 && i < 410 ? 1 : i >= 500 ? -0.7 : 0;
        controlled.climb = i >= 70 && i < 145 ? 1 : i >= 330 && i < 390 ? -1 : 0;
        controlled.aimYaw = Math.PI * 0.25 + Math.sin(i * 0.018) * 0.55;
        stepSim(sim, hf, 1 / 30);
      }
      return {
        hash: hashSim(sim),
        distance: Math.hypot(vulture.transform.x - start.x, vulture.transform.z - start.z),
        pitch: vulture.flight!.pitchAttitude,
        roll: vulture.flight!.rollAttitude,
        destroyed: Boolean(vulture.destroyed),
      };
    };

    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    expect(a.destroyed).toBe(false);
    expect(a.distance).toBeGreaterThan(90);
    expect(Math.abs(a.pitch)).toBeGreaterThan(0.01);
    expect(Math.abs(a.roll)).toBeGreaterThan(0.01);
  });
});

function findBoostableDryBump(
  hf: Heightfield,
  sim: ReturnType<typeof createGameSim>,
): { start: { x: number; z: number }; target: { x: number; z: number } } | undefined {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let cy = 2; cy < hf.cells - 2; cy++) {
    for (let cx = 2; cx < hf.cells - 2; cx++) {
      const idx = sim.nav.index(cx, cy);
      if (hf.walkable[idx] !== 0) continue;
      const target = sim.nav.cellCenter(cx, cy);
      const targetH = sampleHeight(hf, target.x, target.z);
      if (targetH < hf.waterLevel + 1.0) continue;
      if (cellHeightRange(hf, cx, cy) > 7.5) continue;
      for (const [dx, dy] of dirs) {
        const sx = cx + dx;
        const sy = cy + dy;
        if (!sim.nav.isWalkableCell(sx, sy)) continue;
        const start = sim.nav.cellCenter(sx, sy);
        if (Math.abs(targetH - sampleHeight(hf, start.x, start.z)) > 5.8) continue;
        return { start, target };
      }
    }
  }
  return undefined;
}

function cellHeightRange(hf: Heightfield, cx: number, cy: number): number {
  const i00 = cy * hf.samples + cx;
  const h00 = hf.heights[i00];
  const h10 = hf.heights[i00 + 1];
  const h01 = hf.heights[i00 + hf.samples];
  const h11 = hf.heights[i00 + hf.samples + 1];
  return Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
