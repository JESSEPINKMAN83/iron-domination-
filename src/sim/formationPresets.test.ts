import { describe, it, expect } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { presetFormationOffsets, rotateFormationOffset } from './formations';
import { createGameSim, spawnWaspAt, setFormationPreset, issueMoveOrder, stepSim, hashSim } from './world';
import { issueTacticOrder, advanceTacticAfterArrival } from './tactics';
import { serializeSim, loadSerializedSim } from './serialize';

const fixture = () => {
  const hf = generateHeightfield(MAP01);
  const sim = createGameSim(hf);
  const units = Array.from({ length: 6 }, (_, i) => spawnWaspAt(sim, hf, -100 + i * 12, -100, 'Wing', 1));
  return { hf, sim, units };
};

describe('formation presets', () => {
  it.each(['tight', 'spread', 'wedge'] as const)('%s gives 50 aircraft distinct, centered, safely spaced slots', (preset) => {
    const slots = presetFormationOffsets(50, 9, preset);
    expect(slots.reduce((sum, p) => sum + p.x, 0)).toBeCloseTo(0);
    expect(slots.reduce((sum, p) => sum + p.z, 0)).toBeCloseTo(0);
    slots.forEach((a, i) => slots.slice(i + 1).forEach((b) => expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(14.3)));
    expect(Math.max(...slots.map((slot) => Math.abs(slot.x)))).toBeLessThan(200);
  });

  it('makes a narrow staggered block, a broad screen and a distinct swept-back V', () => {
    const tight = presetFormationOffsets(12, 9, 'tight');
    const spread = presetFormationOffsets(12, 9, 'spread');
    const wedge = presetFormationOffsets(6, 9, 'wedge');
    const width = (slots: typeof tight) => Math.max(...slots.map((p) => p.x)) - Math.min(...slots.map((p) => p.x));
    const depth = (slots: typeof tight) => Math.max(...slots.map((p) => p.z)) - Math.min(...slots.map((p) => p.z));
    expect(depth(tight)).toBeGreaterThan(width(tight));
    expect(width(spread)).toBeGreaterThan(width(tight) * 3);
    expect(width(spread)).toBeGreaterThan(depth(spread) * 3);
    const leader = wedge[0];
    wedge.slice(1).forEach((slot) => {
      expect(slot.z).toBeGreaterThan(leader.z);
      expect(slot.z - leader.z).toBeCloseTo(Math.abs(slot.x - leader.x) * 0.9);
    });
  });

  it('keeps separate slots on every leg with zero variation, including after advancing', () => {
    const { sim, units } = fixture();
    setFormationPreset(sim, units, 'wedge');
    const route = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }];
    issueTacticOrder(sim, units, route, { kind: 'attack-through' }, true, 0);
    const slots = units.map((unit) => ({ ...unit.mover!.formationSlot! }));
    units.forEach((unit, i) => {
      expect(unit.mover!.target).toEqual({ x: slots[i].x, z: slots[i].z });
      expect(unit.mover!.tactic!.remaining[1]).toEqual({ x: 100 + slots[i].x, z: 100 + slots[i].z });
      advanceTacticAfterArrival(sim, unit);
      expect(unit.mover!.formationSlot).toEqual(slots[i]);
      expect(unit.mover!.attackThrough).toBe(true);
      expect(unit.mover!.sprint).toBe(true);
    });
    expect(new Set(units.map((unit) => JSON.stringify(unit.mover!.target))).size).toBe(6);
  });

  it('changes formation mid-route without dropping the plan, target or aggressive stance', () => {
    const { sim, units } = fixture();
    setFormationPreset(sim, units, 'tight');
    units.forEach((unit) => unit.mover!.aggressive = true);
    issueTacticOrder(sim, units, [{ x: 0, z: 0 }, { x: 80, z: 100 }], { kind: 'attack-through' }, true);
    const old = units.map((unit) => ({ target: { ...unit.mover!.target! }, slot: { ...unit.mover!.formationSlot! } }));
    setFormationPreset(sim, units, 'spread');
    units.forEach((unit, i) => {
      const mover = unit.mover!;
      expect(mover.tactic!.endAction.kind).toBe('attack-through');
      expect(mover.aggressive).toBe(true);
      expect(mover.sprint).toBe(true);
      expect(mover.target!.x - mover.formationSlot!.x).toBeCloseTo(old[i].target.x - old[i].slot.x);
      expect(mover.tactic!.remaining[0].x - mover.formationSlot!.x).toBeCloseTo(80);
    });
    const restored = loadSerializedSim(generateHeightfield(MAP01), serializeSim(sim));
    expect(hashSim(restored)).toBe(hashSim(sim));
    const before = hashSim(sim);
    units[0].mover!.formationPreset = 'wedge';
    expect(hashSim(sim)).not.toBe(before);
  });

  it('keeps the common destination when some wing members have already parked', () => {
    const { sim, units } = fixture();
    setFormationPreset(sim, units, 'tight');
    issueTacticOrder(sim, units, [{ x: 0, z: 0 }, { x: 80, z: 100 }], { kind: 'attack-through' });
    const first = units[0];
    const final = first.mover!.tactic!.remaining[0];
    first.transform.x = final.x;
    first.transform.z = final.z;
    first.mover!.target = undefined;
    first.mover!.tactic = undefined;
    first.mover!.holdPosition = { ...final };
    setFormationPreset(sim, units, 'spread');
    expect(first.mover!.target!.x - first.mover!.formationSlot!.x).toBeCloseTo(80);
    expect(first.mover!.target!.z - first.mover!.formationSlot!.z).toBeCloseTo(100);
  });

  it.each(['tight', 'spread', 'wedge'] as const)('actually settles a scattered wing into the %s shape', (preset) => {
    const { hf, sim, units } = fixture();
    units.forEach((unit, i) => issueMoveOrder(sim, [unit], -30 + i * 17, 20 + i * 7));
    setFormationPreset(sim, units, preset);
    const targets = units.map((unit) => ({ ...unit.mover!.target! }));
    const origin = { x: targets.reduce((sum, p) => sum + p.x, 0) / units.length, z: targets.reduce((sum, p) => sum + p.z, 0) / units.length };
    const spacing = Math.max(5.2, ...units.map((unit) => unit.mover!.radius * 2 + 2.4));
    const offsets = presetFormationOffsets(units.length, spacing, preset).map((slot) => rotateFormationOffset(slot, units[0].mover!.faceYaw!));
    targets.forEach((point, i) => {
      expect(point.x - origin.x).toBeCloseTo(offsets[i].x);
      expect(point.z - origin.z).toBeCloseTo(offsets[i].z);
    });
    for (let tick = 0; tick < 3600 && units.some((unit) => unit.mover!.target); tick++) stepSim(sim, hf, 1 / 30);
    units.forEach((unit, i) => {
      expect(unit.mover!.target).toBeUndefined();
      expect(unit.transform.x).toBeCloseTo(targets[i].x, 1);
      expect(unit.transform.z).toBeCloseTo(targets[i].z, 1);
    });
  });

  it('keeps a stable heading while switching icons and aligns idle formations to the requested view', () => {
    const { sim, units } = fixture();
    setFormationPreset(sim, units, 'tight', 0.7);
    setFormationPreset(sim, units, 'spread', 1.5);
    setFormationPreset(sim, units, 'wedge', 2.2);
    units.forEach((unit) => expect(unit.mover!.faceYaw).toBeCloseTo(0.7));
    units.forEach((unit) => {
      unit.transform.x = unit.mover!.target!.x;
      unit.transform.z = unit.mover!.target!.z;
      unit.mover!.holdPosition = { ...unit.mover!.target! };
      unit.mover!.target = undefined;
    });
    setFormationPreset(sim, units, 'spread', 1.5);
    units.forEach((unit) => expect(unit.mover!.faceYaw).toBeCloseTo(1.5));
  });

  it('shifts the entire formation inward at the map edge instead of clamping individual slots together', () => {
    const { sim, units } = fixture();
    units.forEach((unit) => {
      unit.transform.x = sim.nav.size / 2 - 4;
      unit.transform.z = sim.nav.size / 2 - 4;
      unit.mover!.holdPosition = { x: unit.transform.x, z: unit.transform.z };
    });
    setFormationPreset(sim, units, 'spread', 0);
    const origins = units.map((unit) => ({ x: unit.mover!.target!.x - unit.mover!.formationSlot!.x, z: unit.mover!.target!.z - unit.mover!.formationSlot!.z }));
    origins.forEach((point) => {
      expect(point.x).toBeCloseTo(origins[0].x);
      expect(point.z).toBeCloseTo(origins[0].z);
    });
    units.forEach((unit) => expect(Math.max(Math.abs(unit.mover!.target!.x), Math.abs(unit.mover!.target!.z))).toBeLessThan(sim.nav.size / 2));
  });

  it('maintains spacing on a straight flight and parks separately at the destination', () => {
    const { hf, sim, units } = fixture();
    setFormationPreset(sim, units, 'spread');
    issueMoveOrder(sim, units, 0, -100);
    for (let tick = 0; tick < 1200 && units.some((unit) => unit.mover!.target); tick++) stepSim(sim, hf, 1 / 30);
    issueTacticOrder(sim, units, [{ x: 0, z: 0 }, { x: 0, z: 150 }], { kind: 'attack-through' }, true);
    for (let tick = 0; tick < 1800; tick++) {
      stepSim(sim, hf, 1 / 30);
      if (tick % 30 === 0) units.forEach((a, i) => units.slice(i + 1).forEach((b) => expect(Math.hypot(a.transform.x - b.transform.x, a.transform.z - b.transform.z)).toBeGreaterThan(4)));
    }
    expect(units.every((unit) => !unit.mover!.target && !unit.mover!.tactic)).toBe(true);
    expect(new Set(units.map((unit) => `${unit.transform.x.toFixed(1)},${unit.transform.z.toFixed(1)}`)).size).toBe(6);
  });
});
