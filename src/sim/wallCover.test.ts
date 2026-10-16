import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { STRUCTURES, WALL_HEIGHT } from '../content/phase3';
import { generateHeightfield } from './heightfield';
import { createGameSim } from './world';
import { createEconomy, createInitialBase, placeStructure, spawnInfantryAt, updatePlacement } from './economy';
import { manualFireAt, stepCombat } from './combat';
import { firstWallCoverHit } from './wallCover';

function fixture() {
  const hf = generateHeightfield({ ...MAP01, cells: 128 });
  hf.heights.fill(10); hf.walkable.fill(1); hf.waterLevel = 0;
  const sim = createGameSim(hf), economy = createEconomy(1, 10000);
  createInitialBase(sim, hf, economy, -60, 30);
  economy.readyDefenseStructure = 'wall';
  const wall = placeStructure(sim, hf, economy, updatePlacement(sim, hf, 'wall', 0, 0, 1))!;
  wall.building!.buildProgress = 1;
  const sniper = spawnInfantryAt(sim, -50, 0, 2, 'sniper');
  sniper.transform.y = 10;
  sniper.turret!.yaw = Math.PI / 2;
  const infantry = spawnInfantryAt(sim, 50, 0, 1, 'infantry');
  infantry.transform.y = 10;
  infantry.weapon = undefined; infantry.weapons = undefined;
  return { sim, wall, sniper, infantry };
}

describe('taller, affordable bullet cover', () => {
  it('costs 40 credits per segment and has a wall body well above a standing soldier', () => {
    expect(STRUCTURES.wall.cost).toBe(40);
    expect(WALL_HEIGHT).toBe(5.2);
  });

  it('protects infantry from automatic sniper fire through an intact wall', () => {
    const { sim, sniper, infantry } = fixture();
    for (let i = 0; i < 100; i++) {
      sim.tick++;
      stepCombat(sim, 1 / 30);
    }
    expect(infantry.health!.current).toBe(infantry.health!.max);
    expect(sniper.weapon!.targetId).toBeUndefined();
    expect(sim.events.filter((event) => event.weaponKind === 'sniperRifle')).toHaveLength(0);
  });

  it('stops player-fired sniper bullets at the wall instead of damaging the unit behind it', () => {
    const { sim, wall, sniper, infantry } = fixture();
    sniper.playerControlled = { throttle: 0, turn: 0, aimYaw: Math.PI / 2 };
    expect(manualFireAt(sim, sniper, infantry.transform.x, infantry.transform.z)).toBe(true);
    expect(infantry.health!.current).toBe(infantry.health!.max);
    expect(wall.health!.current).toBeLessThan(wall.health!.max);
    const shot = sim.events.find((event) => event.weaponKind === 'sniperRifle')!;
    expect(shot.toX).toBeCloseTo(-4);
    expect(shot.targetId).toBe(wall.id);
  });

  it('allows fire around a wall and from high enough above it', () => {
    const { sim, sniper, infantry } = fixture();
    expect(firstWallCoverHit(sim, { x: -50, y: 25, z: 0 }, { x: 50, y: 11.15, z: 0 })).toBeUndefined();
    sniper.transform.z = infantry.transform.z = 20;
    stepCombat(sim, 1 / 30);
    expect(infantry.health!.current).toBeLessThan(infantry.health!.max);
  });

  it('opens a firing gap as soon as the wall is destroyed', () => {
    const { sim, wall, infantry } = fixture();
    stepCombat(sim, 1 / 30);
    wall.destroyed = { remaining: 20 };
    sim.nav.removeDynamicBlocker(wall.id);
    expect(firstWallCoverHit(sim, { x: -50, y: 11.72, z: 0 }, { x: 50, y: 11.15, z: 0 })).toBeUndefined();
    for (let i = 0; i < 15; i++) stepCombat(sim, 1 / 30);
    expect(infantry.health!.current).toBeLessThan(infantry.health!.max);
  });

  it('invalidates cover lookups when a wall is newly placed', () => {
    const { sim, wall } = fixture();
    wall.destroyed = { remaining: 20 };
    sim.nav.removeDynamicBlocker(wall.id);
    const from = { x: -50, y: 12, z: 0 }, to = { x: 50, y: 12, z: 0 };
    expect(firstWallCoverHit(sim, from, to)).toBeUndefined();
    wall.destroyed = undefined;
    sim.nav.setBuildingBlocker(wall.id, wall.transform.x, wall.transform.z, 4, 4);
    expect(firstWallCoverHit(sim, from, to)?.wall).toBe(wall);
  });

  it('uses construction height and treats walls from either army as solid cover', () => {
    const { sim, wall } = fixture();
    const from = { x: -50, y: 13, z: 0 }, to = { x: 50, y: 13, z: 0 };
    expect(firstWallCoverHit(sim, from, to)?.wall).toBe(wall);
    wall.building!.buildProgress = 0.2;
    expect(firstWallCoverHit(sim, from, to)).toBeUndefined();
    wall.building!.buildProgress = 1;
    wall.team!.id = 2;
    expect(firstWallCoverHit(sim, from, to)?.wall).toBe(wall); // either army's wall is solid
  });
});
