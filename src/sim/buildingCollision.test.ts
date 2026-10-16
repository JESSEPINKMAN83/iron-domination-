import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import { generateHeightfield } from './heightfield';
import { createEconomy, createInitialBase, placeStructure, spawnInfantryAt, updatePlacement } from './economy';
import { createGameSim, issueMoveOrder, spawnTankAt, stepSim } from './world';
import { serializeSim, loadSerializedSim } from './serialize';

function fixture() {
  const hf = generateHeightfield({ ...MAP01, cells: 128 });
  hf.heights.fill(10); hf.walkable.fill(1); hf.waterLevel = 0;
  const sim = createGameSim(hf), economy = createEconomy(1, 10000);
  const base = createInitialBase(sim, hf, economy, -80, 0);
  const place = (kind: StructureKind) => {
    economy.doctrine = STRUCTURES[kind].doctrine ?? 'iron-legion';
    economy.readyStructure = kind;
    economy.readyDefenseStructure = kind;
    const spot = updatePlacement(sim, hf, kind, 0, 0, 1);
    expect(spot.valid).toBe(true);
    const building = placeStructure(sim, hf, economy, spot)!;
    expect(building).toBeDefined();
    return building;
  };
  return { hf, sim, economy, base, place };
}

describe('solid building foundations', () => {
  it.each(Object.keys(STRUCTURES) as StructureKind[])('%s registers its visible footprint as a ground obstacle', (kind) => {
    const { sim, hf, place, base } = fixture();
    const building = place(kind);
    for (const entity of [base, building]) {
      const halfW = entity.building!.footprint.w * hf.cellSize;
      const halfD = entity.building!.footprint.h * hf.cellSize;
      for (const [x, z] of [[0, 0], [-halfW + 1, -halfD + 1], [halfW - 1, halfD - 1]]) {
        const cell = sim.nav.worldToCell(entity.transform.x + x, entity.transform.z + z);
        expect(sim.nav.isWalkableCell(cell.x, cell.y)).toBe(false);
      }
    }
  });

  it('rejects foundations that overlap an existing building or seal its access corridor', () => {
    const { sim, hf, base } = fixture();
    expect(updatePlacement(sim, hf, 'power-plant', base.transform.x + 28, base.transform.z, 1).valid).toBe(false);
    expect(updatePlacement(sim, hf, 'power-plant', base.transform.x + 40, base.transform.z, 1).valid).toBe(true);
  });

  it.each([1, 2])('team %i infantry and tanks go around a factory and finish their move', (team) => {
    for (const infantry of [false, true]) {
      const { sim, hf, place } = fixture();
      const building = place('factory');
      const unit = infantry ? spawnInfantryAt(sim, -45, 0, team, 'infantry') : spawnTankAt(sim, -45, 0, 'Tank', team);
      expect(issueMoveOrder(sim, [unit], 50, 0)).toBe(true);
      let detour = false;
      for (let i = 0; i < 750; i++) {
        stepSim(sim, hf, 1 / 30);
        const x = Math.abs(unit.transform.x - building.transform.x), z = Math.abs(unit.transform.z - building.transform.z);
        expect(x > 16 || z > 14).toBe(true);
        detour ||= Math.abs(unit.transform.z) > 14;
      }
      expect(detour).toBe(true);
      expect(unit.transform.x).toBeGreaterThan(45);
    }
  });

  it('rebuilds an already-issued route when a building is placed across it', () => {
    const { sim, hf, place } = fixture();
    const unit = spawnTankAt(sim, -45, 0, 'Tank', 2);
    issueMoveOrder(sim, [unit], 50, 0);
    place('factory');
    for (let i = 0; i < 750; i++) {
      stepSim(sim, hf, 1 / 30);
      expect(Math.abs(unit.transform.x) > 16 || Math.abs(unit.transform.z) > 14).toBe(true);
    }
    expect(unit.transform.x).toBeGreaterThan(45);
  });

  it('stops boosted V-mode movement instead of tunneling through a building', () => {
    const { sim, hf, place } = fixture();
    place('factory');
    const unit = spawnTankAt(sim, -45, 0, 'Boosted tank', 1);
    unit.transform.rot = Math.PI / 2;
    unit.mover!.speed = 200;
    unit.playerControlled = { throttle: 1, turn: 0, aimYaw: Math.PI / 2, boost: true };
    stepSim(sim, hf, 0.25);
    expect(unit.transform.x).toBeLessThan(-16);
  });

  it('restores building collision from old saves and moves enclosed units outside', () => {
    const { sim, hf, place } = fixture();
    place('factory');
    const unit = spawnInfantryAt(sim, 0, 0, 2, 'infantry');
    const saved = serializeSim(sim);
    saved.dynamicBlockers = [];
    const restored = loadSerializedSim(hf, saved);
    stepSim(restored, hf, 1 / 30);
    const moved = [...restored.world.entities].find((entity) => entity.id === unit.id)!;
    expect(Math.abs(moved.transform.x) > 16 || Math.abs(moved.transform.z) > 14).toBe(true);
    const center = restored.nav.worldToCell(0, 0);
    expect(restored.nav.isWalkableCell(center.x, center.y)).toBe(false);
  });
});
