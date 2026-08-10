import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { FlowField } from './flowfield';
import { generateHeightfield, sampleHeight, type Heightfield } from './heightfield';
import { createEconomy, createInitialBase, spawnInfantryAt } from './economy';
import { attackStandoffPoint, createGameSim, hashSim, issueMoveOrder, selectedEntities, setSelected, spawnDebugTanks, spawnHammerheadAt, spawnScoutTankAt, spawnSiegeTankAt, spawnTankAt, spawnVultureAt, spawnWaspAt, stepSim } from './world';

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

  it('keeps possessed tanks responsive instead of applying RTS U-turn limits in V-mode', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnSiegeTankAt(sim, 0, 0, 'Mauler');
    tank.playerControlled = { throttle: 1, turn: 1, aimYaw: 0 };

    for (let tick = 0; tick < 30; tick++) stepSim(sim, hf, 1 / 30);

    expect(Math.abs(angleDelta(tank.transform.rot, 0))).toBeGreaterThan(1);
    expect(tank.mover?.turnaround).toBeUndefined();
  });

  it('smooths a possessed tank turn without making V-mode sluggish', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tank = spawnSiegeTankAt(sim, 0, 0, 'Mauler');
    tank.playerControlled = { throttle: 0, turn: 1, aimYaw: 0 };

    stepSim(sim, hf, 1 / 60);
    expect(tank.mover?.yawRate).toBeGreaterThan(0);
    expect(tank.mover?.yawRate).toBeLessThan(1.55);
    for (let tick = 0; tick < 29; tick++) stepSim(sim, hf, 1 / 60);
    expect(Math.abs(angleDelta(tank.transform.rot, 0))).toBeGreaterThan(0.65);

    tank.playerControlled.turn = -1;
    stepSim(sim, hf, 1 / 60);
    expect(tank.mover?.yawRate).toBeGreaterThan(0);
    for (let tick = 0; tick < 12; tick++) stepSim(sim, hf, 1 / 60);
    expect(tank.mover?.yawRate).toBeLessThan(0);
  });

  it('gives larger tracked vehicles a wider, slower RTS turnaround without reversing first', () => {
    const run = (kind: 'scout' | 'standard' | 'siege') => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const tank = kind === 'scout'
        ? spawnScoutTankAt(sim, 0, 0, 'Jackal')
        : kind === 'siege'
          ? spawnSiegeTankAt(sim, 0, 0, 'Mauler')
          : spawnTankAt(sim, 0, 0, 'M-17');
      const targetCell = sim.nav.nearestWalkableCell(0, 110, 128);
      expect(targetCell).toBeDefined();
      const target = sim.nav.cellCenter(targetCell!.x, targetCell!.y);
      const targetYaw = Math.atan2(target.x - tank.transform.x, target.z - tank.transform.z);
      tank.transform.rot = targetYaw + Math.PI;
      tank.previousTransform.rot = tank.transform.rot;
      expect(issueMoveOrder(sim, [tank], target.x, target.z)).toBe(true);
      expect(tank.mover?.turnaround).toBeDefined();
      let distance = 0;
      let yawTravel = 0;
      let firstForwardTravel = 0;
      let turnaroundTicks = 0;
      const initialForwardX = Math.sin(tank.transform.rot);
      const initialForwardZ = Math.cos(tank.transform.rot);
      for (let tick = 0; tick < 300 && tank.mover?.turnaround; tick++) {
        const beforeX = tank.transform.x;
        const beforeZ = tank.transform.z;
        const beforeYaw = tank.transform.rot;
        stepSim(sim, hf, 1 / 30);
        turnaroundTicks++;
        const dx = tank.transform.x - beforeX;
        const dz = tank.transform.z - beforeZ;
        distance += Math.hypot(dx, dz);
        yawTravel += Math.abs(angleDelta(tank.transform.rot, beforeYaw));
        if (tick < 12) firstForwardTravel += dx * initialForwardX + dz * initialForwardZ;
      }
      expect(
        tank.mover?.turnaround,
        `${kind} should finish its turnaround (rot=${tank.transform.rot}, yawRate=${tank.mover?.yawRate})`,
      ).toBeUndefined();
      return { radius: distance / yawTravel, turnaroundTicks, firstForwardTravel };
    };

    const scout = run('scout');
    const standard = run('standard');
    const siege = run('siege');
    expect(standard.radius).toBeGreaterThan(scout.radius * 1.2);
    expect(siege.radius).toBeGreaterThan(standard.radius * 1.35);
    expect(scout.radius).toBeLessThan(7.5);
    expect(standard.radius).toBeLessThan(9.5);
    expect(siege.radius).toBeLessThan(13);
    expect(standard.turnaroundTicks).toBeGreaterThan(scout.turnaroundTicks);
    expect(siege.turnaroundTicks).toBeGreaterThan(standard.turnaroundTicks);
    expect(siege.turnaroundTicks).toBeLessThan(105);
    expect(scout.firstForwardTravel).toBeGreaterThan(0);
    expect(standard.firstForwardTravel).toBeGreaterThan(0);
    expect(siege.firstForwardTravel).toBeGreaterThan(0);
  });

  it('moves strategy units faster for a sprint order and clears sprint on the next normal order', () => {
    const run = (sprint: boolean) => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const [tank] = spawnDebugTanks(sim, hf, 1);
      const start = { x: tank.transform.x, z: tank.transform.z };
      const cell = sim.nav.nearestWalkableCell(tank.transform.x + 100, tank.transform.z + 35, 96);
      expect(cell).toBeDefined();
      const target = sim.nav.cellCenter(cell!.x, cell!.y);
      expect(issueMoveOrder(sim, [tank], target.x, target.z, false, undefined, undefined, sprint)).toBe(true);
      for (let i = 0; i < 45; i++) stepSim(sim, hf, 1 / 30);
      return {
        distance: Math.hypot(tank.transform.x - start.x, tank.transform.z - start.z),
        hf,
        sim,
        tank,
        target,
      };
    };

    const normal = run(false);
    const rapid = run(true);
    expect(rapid.distance).toBeGreaterThan(normal.distance * 1.35);
    expect(rapid.tank.mover?.sprint).toBe(true);

    expect(issueMoveOrder(rapid.sim, [rapid.tank], rapid.target.x, rapid.target.z)).toBe(true);
    expect(rapid.tank.mover?.sprint).toBeUndefined();
  });

  it('briefly holds knocked-down infantry, then restores its move order', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const startCell = sim.nav.nearestWalkableCell(-40, -40) ?? sim.nav.nearestWalkableCellGlobal(-40, -40);
    const endCell = sim.nav.nearestWalkableCell(40, 40) ?? sim.nav.nearestWalkableCellGlobal(40, 40);
    expect(startCell).toBeDefined();
    expect(endCell).toBeDefined();
    const start = sim.nav.cellCenter(startCell!.x, startCell!.y);
    const end = sim.nav.cellCenter(endCell!.x, endCell!.y);
    const soldier = spawnInfantryAt(sim, start.x, start.z, 1, 'infantry');
    expect(issueMoveOrder(sim, [soldier], end.x, end.z)).toBe(true);
    soldier.impactMomentum = { x: 0, z: 0, yaw: 0, ttl: 1, stagger: 1 };

    for (let i = 0; i < 15; i++) stepSim(sim, hf, 1 / 30);
    const duringFall = Math.hypot(soldier.transform.x - start.x, soldier.transform.z - start.z);
    expect(duringFall).toBeLessThan(0.25);

    for (let i = 0; i < 60; i++) stepSim(sim, hf, 1 / 30);
    const afterRecovery = Math.hypot(soldier.transform.x - start.x, soldier.transform.z - start.z);
    expect(afterRecovery).toBeGreaterThan(2);
    expect(soldier.mover?.target).toBeDefined();
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

  it('moves toward the nearest reachable shore when the clicked land is disconnected', () => {
    const hf = generateHeightfield(MAP01);
    hf.walkable.fill(1);
    const dividerX = Math.floor(hf.cells / 2);
    for (let y = 0; y < hf.cells; y++) hf.walkable[y * hf.cells + dividerX] = 0;
    const sim = createGameSim(hf);
    const tank = spawnTankAt(sim, -80, 0, 'Reachability Tank');

    expect(issueMoveOrder(sim, [tank], 80, 0)).toBe(true);

    expect(tank.mover?.target?.x).toBeLessThan(0);
    expect(tank.mover?.flow?.directionAt(tank.transform.x, tank.transform.z).distance).toBeGreaterThan(0);
    stepSim(sim, hf, 1 / 30);
    expect(Math.hypot(tank.velocity?.x ?? 0, tank.velocity?.z ?? 0)).toBeGreaterThan(0);
  });

  it('gives each selected unit a reachable fallback when the group spans disconnected terrain', () => {
    const hf = generateHeightfield(MAP01);
    hf.walkable.fill(1);
    const dividerX = Math.floor(hf.cells / 2);
    for (let y = 0; y < hf.cells; y++) hf.walkable[y * hf.cells + dividerX] = 0;
    const sim = createGameSim(hf);
    const left = spawnTankAt(sim, -80, 0, 'Left Tank');
    const right = spawnTankAt(sim, 80, 0, 'Right Tank');

    expect(issueMoveOrder(sim, [left, right], 0, 0)).toBe(true);

    expect(left.mover?.target?.x).toBeLessThan(0);
    expect(right.mover?.target?.x).toBeGreaterThan(0);
    expect(left.mover?.flow?.directionAt(left.transform.x, left.transform.z).distance).toBeGreaterThan(0);
    expect(right.mover?.flow?.directionAt(right.transform.x, right.transform.z).distance).toBeGreaterThan(0);
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

  it('honors right-drag style move orders with a final facing direction and combat formation', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tanks = spawnDebugTanks(sim, hf, 4);
    const target = sim.nav.nearestWalkableCell(tanks[0].transform.x + 36, tanks[0].transform.z + 12, 96);
    expect(target).toBeDefined();
    const p = sim.nav.cellCenter(target!.x, target!.y);
    const faceYaw = Math.PI / 2;

    expect(issueMoveOrder(sim, tanks, p.x, p.z, false, faceYaw)).toBe(true);

    const destinations = tanks.map((tank) => tank.mover?.target);
    expect(destinations.every(Boolean)).toBe(true);
    const spanX = Math.max(...destinations.map((point) => point!.x)) - Math.min(...destinations.map((point) => point!.x));
    const spanZ = Math.max(...destinations.map((point) => point!.z)) - Math.min(...destinations.map((point) => point!.z));
    expect(spanZ).toBeGreaterThan(spanX);

    for (let i = 0; i < 30 * 12; i++) stepSim(sim, hf, 1 / 30);

    expect(tanks.some((tank) => Math.abs(angleDelta(tank.transform.rot, faceYaw)) < 0.2)).toBe(true);
    expect(tanks.every((tank) => tank.mover?.faceYaw === faceYaw)).toBe(true);
  });

  it('uses right-drag distance to transition from a deep formation into wider battle ranks', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tanks = spawnDebugTanks(sim, hf, 6);
    const target = sim.nav.nearestWalkableCell(tanks[0].transform.x + 36, tanks[0].transform.z + 12, 96);
    expect(target).toBeDefined();
    const p = sim.nav.cellCenter(target!.x, target!.y);
    const faceYaw = Math.PI / 2;

    expect(issueMoveOrder(sim, tanks, p.x, p.z, false, faceYaw, 18)).toBe(true);
    const tightDestinations = tanks.map((tank) => tank.mover?.target);
    const tightSpanZ = Math.max(...tightDestinations.map((point) => point!.z)) - Math.min(...tightDestinations.map((point) => point!.z));
    const tightSpanX = Math.max(...tightDestinations.map((point) => point!.x)) - Math.min(...tightDestinations.map((point) => point!.x));

    expect(issueMoveOrder(sim, tanks, p.x, p.z, false, faceYaw, 72)).toBe(true);
    const wideDestinations = tanks.map((tank) => tank.mover?.target);
    const wideSpanZ = Math.max(...wideDestinations.map((point) => point!.z)) - Math.min(...wideDestinations.map((point) => point!.z));
    const wideSpanX = Math.max(...wideDestinations.map((point) => point!.x)) - Math.min(...wideDestinations.map((point) => point!.x));

    expect(wideSpanZ).toBeGreaterThan(tightSpanZ * 1.7);
    expect(wideSpanX).toBeGreaterThan(5);
    expect(wideSpanX).toBeLessThanOrEqual(tightSpanX);
    expect(tanks.every((tank) => tank.mover?.faceYaw === faceYaw)).toBe(true);
  });

  it('finishes a right-drag order on reachable collision-safe formation slots', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tanks = spawnDebugTanks(sim, hf, 5);
    const target = sim.nav.nearestWalkableCell(tanks[0].transform.x + 44, tanks[0].transform.z + 20, 96);
    expect(target).toBeDefined();
    const p = sim.nav.cellCenter(target!.x, target!.y);
    const faceYaw = Math.PI * 0.35;

    expect(issueMoveOrder(sim, tanks, p.x, p.z, false, faceYaw, 12)).toBe(true);
    const destinations = tanks.map((tank) => ({
      x: tank.mover!.target!.x + (tank.mover!.formationOffset?.x ?? 0),
      z: tank.mover!.target!.z + (tank.mover!.formationOffset?.z ?? 0),
    }));
    const minimumSpacing = Math.max(...tanks.map((tank) => tank.mover!.radius * 2 + 2.4));
    for (let i = 1; i < destinations.length; i++) {
      expect(Math.hypot(destinations[i].x - destinations[i - 1].x, destinations[i].z - destinations[i - 1].z)).toBeGreaterThanOrEqual(minimumSpacing - 0.1);
    }

    for (let i = 0; i < 30 * 16; i++) stepSim(sim, hf, 1 / 30);

    tanks.forEach((tank, index) => {
      expect(Math.hypot(tank.transform.x - destinations[index].x, tank.transform.z - destinations[index].z)).toBeLessThan(2.5);
      expect(Math.abs(angleDelta(tank.transform.rot, faceYaw))).toBeLessThan(0.2);
    });

    for (let i = 0; i < 30 * 8; i++) stepSim(sim, hf, 1 / 30);
    tanks.forEach((tank, index) => {
      expect(Math.hypot(tank.transform.x - destinations[index].x, tank.transform.z - destinations[index].z)).toBeLessThan(0.5);
      expect(tank.mover?.holdPosition).toEqual(destinations[index]);
    });
  });

  it('assigns mixed ground and air units to distinct combat-formation slots', () => {
    const hf = generateHeightfield(MAP01);
    const sim = createGameSim(hf);
    const tanks = spawnDebugTanks(sim, hf, 2);
    const flyers = [
      spawnVultureAt(sim, hf, tanks[0].transform.x - 8, tanks[0].transform.z - 8, 'Vulture A'),
      spawnVultureAt(sim, hf, tanks[0].transform.x - 12, tanks[0].transform.z - 12, 'Vulture B'),
    ];
    const units = [tanks[0], flyers[0], tanks[1], flyers[1]];
    const target = sim.nav.nearestWalkableCell(tanks[0].transform.x + 48, tanks[0].transform.z + 18, 96);
    expect(target).toBeDefined();
    const p = sim.nav.cellCenter(target!.x, target!.y);

    expect(issueMoveOrder(sim, units, p.x, p.z, false, Math.PI / 2, 60)).toBe(true);

    const destinations = units.map((unit) => ({
      x: unit.mover!.target!.x + (unit.mover!.formationOffset?.x ?? 0),
      z: unit.mover!.target!.z + (unit.mover!.formationOffset?.z ?? 0),
    }));
    const unique = new Set(destinations.map((point) => `${point.x.toFixed(2)}:${point.z.toFixed(2)}`));
    expect(unique.size).toBe(units.length);
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

  it('spirals every aircraft class down and emits one crash per ground impact', () => {
    const run = () => {
      const hf = generateHeightfield(MAP01);
      const sim = createGameSim(hf);
      const aircraft = [
        spawnWaspAt(sim, hf, -20, -12, 'Wasp'),
        spawnVultureAt(sim, hf, 0, -12, 'Vulture'),
        spawnHammerheadAt(sim, hf, 20, -12, 'Hammerhead'),
      ];
      const starts = aircraft.map((entity) => ({
        x: entity.transform.x,
        y: entity.transform.y ?? 0,
        z: entity.transform.z,
      }));
      for (const entity of aircraft) {
        entity.velocity!.x = Math.sin(entity.transform.rot) * entity.mover!.speed * 0.55;
        entity.velocity!.z = Math.cos(entity.transform.rot) * entity.mover!.speed * 0.55;
        entity.destroyed = { remaining: 20 };
      }
      for (let i = 0; i < 210; i++) stepSim(sim, hf, 1 / 30);
      return { sim, hf, aircraft, starts, hash: hashSim(sim) };
    };

    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    for (let i = 0; i < a.aircraft.length; i++) {
      const entity = a.aircraft[i];
      const start = a.starts[i];
      expect(entity.destroyed?.aircraftCrash?.impacted).toBe(true);
      expect(entity.transform.y).toBeCloseTo(sampleHeight(a.hf, entity.transform.x, entity.transform.z) + 0.42, 2);
      expect(Math.hypot(entity.transform.x - start.x, entity.transform.z - start.z)).toBeGreaterThan(10);
      expect((entity.transform.y ?? 0)).toBeLessThan(start.y);
    }
    expect(a.sim.events.filter((event) => event.kind === 'crash')).toHaveLength(3);
    expect(a.sim.events.filter((event) => event.kind === 'aircraft-crash-smoke').length).toBeGreaterThan(6);

    for (let i = 0; i < 30; i++) stepSim(a.sim, a.hf, 1 / 30);
    expect(a.sim.events.filter((event) => event.kind === 'crash')).toHaveLength(3);
  });
});

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
