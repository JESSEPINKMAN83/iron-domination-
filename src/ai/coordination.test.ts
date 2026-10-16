import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP01 } from '../content/map01';
import type { Entity } from '../sim/components';
import { createEconomy, createInitialBase } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { VisibilityGrid } from '../sim/visibility';
import { createGameSim, hashSim, spawnTankAt, spawnVultureAt, spawnHammerheadAt } from '../sim/world';
import { EnemyCommander } from './commander';

type TestSquad = { units: Entity[]; state: string; nextOrderAt: number; maneuver?: string; stagingPoint?: { x: number; z: number }; rallyPoint?: { x: number; z: number }; regroupStartedAt?: number; operation?: { objective: { x: number; z: number; entity?: Entity }; deadline: number; released: boolean } };
function fixture(count = 14, airCount = 4, doctrine: 'iron-legion' | 'missile-command' = 'iron-legion') {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const hf = generateHeightfield(MAP01), sim = createGameSim(hf);
  const economy = createEconomy(2, 7500, doctrine);
  const base = createInitialBase(sim, hf, economy, -180, 0);
  const player = createInitialBase(sim, hf, createEconomy(1), 190, 0);
  const vision = new VisibilityGrid(hf, 2);
  const commander = new EnemyCommander(sim, hf, economy, vision, 'rusher', 'hard', [{ x: 190, z: 0 }]);
  const ground = Array.from({ length: count }, (_, i) => spawnTankAt(sim, -135 + i % 4 * 9, -20 + Math.floor(i / 4) * 10, `Ground ${i}`, 2));
  const air = Array.from({ length: airCount }, (_, i) => [spawnVultureAt, spawnHammerheadAt][i % 2](sim, hf, -145, 40 + i * 15, `Escort ${i}`, 2));
  const control = commander as unknown as { elapsed: number; squads: TestSquad[]; commandSquads(): void; operationTarget(squad: TestSquad): { x: number; z: number; entity?: Entity } };
  control.elapsed = 180;
  return { hf, sim, base, player, vision, commander, ground, air, control };
}
afterEach(() => vi.restoreAllMocks());

describe('coordinated enemy assaults', () => {
  it('attaches aircraft to ground assaults and keeps escort destinations near the ground advance', () => {
    const { sim, control, air, commander } = fixture();
    control.commandSquads();
    const squad = control.squads[0];
    const ground = squad.units.filter((unit) => !unit.flight);
    expect(squad.units.filter((unit) => unit.flight)).toHaveLength(2);
    expect(commander.stats.airSupportedAttacks).toBe(1);
    const center = ground.reduce((p, unit) => ({ x: p.x + unit.transform.x / ground.length, z: p.z + unit.transform.z / ground.length }), { x: 0, z: 0 });
    air.slice(0, 2).forEach((unit) => {
      expect(unit.mover!.aggressive).toBe(true);
      expect(Math.hypot(unit.mover!.target!.x - center.x, unit.mover!.target!.z - center.z)).toBeLessThan(55);
      expect(unit.mover!.tactic).toBeUndefined();
    });
    const plan = ground[0].mover!.tactic;
    ground.forEach((unit) => unit.transform.x += 55);
    sim.tick += 150;
    control.commandSquads();
    expect(ground[0].mover!.tactic).toBe(plan);
    expect(air[0].mover!.target!.x).toBeGreaterThan(center.x + 40);
    expect(control.squads.every((candidate) => candidate.units.some((unit) => !unit.flight))).toBe(true);
  });

  it('interrupts ground and aircraft orders immediately when a mixed squad retreats', () => {
    const { sim, control } = fixture();
    control.commandSquads();
    const squad = control.squads[0];
    squad.units.forEach((unit) => unit.health!.current = unit.health!.max * 0.2);
    sim.tick += 150;
    control.commandSquads();
    expect(squad.state).toBe('retreating');
    for (const unit of squad.units) {
      expect(unit.mover!.tactic).toBeUndefined();
      expect(unit.mover!.attackThrough).toBeFalsy();
      expect(unit.mover!.target!.x).toBeLessThan(-180);
    }
  });

  it.each(['iron-legion', 'missile-command'] as const)('stages and releases coordinated opposite flanks for %s', (doctrine) => {
    const { sim, control, commander } = fixture(14, doctrine === 'iron-legion' ? 4 : 0, doctrine);
    control.commandSquads();
    control.commandSquads();
    const [left, right] = control.squads.filter((squad) => squad.state === 'staging');
    expect(left.operation).toBe(right.operation);
    expect(left.maneuver).toBe('left');
    expect(right.maneuver).toBe('right');
    expect(left.stagingPoint!.z).toBeLessThan(0);
    expect(right.stagingPoint!.z).toBeGreaterThan(0);
    const plan = left.units[0].mover!.tactic;
    sim.tick += 150;
    control.commandSquads();
    expect(left.units[0].mover!.tactic).toBe(plan);
    expect(left.state).toBe('staging');
    for (const squad of [left, right]) for (const unit of squad.units.filter((unit) => !unit.flight)) {
      unit.transform.x = squad.stagingPoint!.x;
      unit.transform.z = squad.stagingPoint!.z;
      unit.mover!.target = undefined;
      unit.mover!.tactic = undefined;
    }
    sim.tick += 150;
    control.commandSquads();
    expect(left.state).toBe('attacking');
    expect(right.state).toBe('attacking');
    expect(left.operation!.released).toBe(true);
    expect(commander.stats.coordinatedAttacks).toBe(1);
    for (const squad of [left, right]) expect(squad.units.filter((unit) => !unit.flight).every((unit) => unit.mover!.attackThrough)).toBe(true);
  });

  it('saves incremental recruits for a paired attack instead of launching every small wave', () => {
    const { sim, control, commander } = fixture(8, 0);
    control.commandSquads();
    control.commandSquads();
    expect(commander.stats.attacksLaunched).toBe(1);
    for (let i = 0; i < 4; i++) spawnTankAt(sim, -140, 50 + i * 10, 'Fresh recruit', 2);
    sim.tick += 150;
    control.commandSquads();
    expect(commander.stats.attacksLaunched).toBe(3);
    expect(commander.stats.coordinatedAttacks).toBe(1);
  });

  it('has a bounded rendezvous wait if one flank cannot reach its staging point', () => {
    const { sim, control } = fixture();
    control.commandSquads(); control.commandSquads();
    const pair = control.squads.filter((squad) => squad.state === 'staging');
    sim.tick = pair[0].operation!.deadline + 150;
    control.commandSquads();
    expect(pair.every((squad) => squad.state === 'attacking')).toBe(true);
    expect(pair.every((squad) => squad.units.some((unit) => unit.mover?.target))).toBe(true);
  });

  it('chooses an unblocked regrouping point when the space behind its base is occupied', () => {
    const { sim, control } = fixture(6, 0);
    sim.nav.setDynamicBlocker(9999, -222, 0, 20);
    control.commandSquads();
    const squad = control.squads[0];
    squad.units.forEach((unit) => unit.health!.current = unit.health!.max * 0.2);
    sim.tick += 150;
    control.commandSquads();
    expect(squad.state).toBe('retreating');
    const cell = sim.nav.worldToCell(squad.rallyPoint!.x, squad.rallyPoint!.z);
    expect(sim.nav.isWalkableCell(cell.x, cell.y)).toBe(true);
  });

  it('retreats after losing most of a squad even if the survivors have full health', () => {
    const { sim, control, commander } = fixture(6, 0);
    control.commandSquads();
    const squad = control.squads[0];
    squad.units.slice(0, 3).forEach((unit) => sim.world.remove(unit));
    sim.tick += 150;
    control.commandSquads();
    expect(squad.state).toBe('retreating');
    expect(commander.stats.retreats).toBe(1);
    expect(squad.units[0].health!.current).toBe(squad.units[0].health!.max);
    expect(squad.units.every((unit) => !unit.mover!.tactic && unit.mover!.aggressive)).toBe(true);
  });

  it.each(['iron-legion', 'missile-command'] as const)('regroups damaged %s forces and relaunches only with reinforcements', (doctrine) => {
    const { sim, base, control, commander } = fixture(6, 0, doctrine);
    control.commandSquads();
    const squad = control.squads[0];
    const wounded = [...squad.units];
    wounded.forEach((unit) => unit.health!.current = unit.health!.max * 0.2);
    sim.tick += 150; control.commandSquads();
    wounded.forEach((unit) => {
      unit.transform.x = squad.rallyPoint!.x;
      unit.transform.z = squad.rallyPoint!.z;
      unit.mover!.target = undefined;
    });
    sim.tick += 150; control.commandSquads();
    expect(squad.state).toBe('regrouping');
    expect(squad.units).toHaveLength(0);
    sim.tick += 30 * 15; control.commandSquads();
    expect(squad.state).toBe('regrouping');
    expect(commander.stats.attacksLaunched).toBe(1);
    for (let i = 0; i < 4; i++) spawnTankAt(sim, base.transform.x + 15 + i * 9, base.transform.z + 25, 'Reinforcement', 2);
    sim.tick += 150; control.commandSquads();
    expect(squad.state).toBe('attacking');
    expect(commander.stats.regroupsCompleted).toBe(1);
    expect(squad.units).toHaveLength(4);
    expect(squad.units.every((unit) => !wounded.includes(unit))).toBe(true);
    wounded.forEach((unit) => expect(unit.health!.current).toBeCloseTo(unit.health!.max * 0.2));
  });

  it('uses the last observed objective when an enemy moves into fog, not its live hidden position', () => {
    const { control, player, vision } = fixture();
    vi.spyOn(vision, 'isVisibleWorld').mockReturnValue(true);
    control.commandSquads(); control.commandSquads();
    const squad = control.squads.find((candidate) => candidate.operation)!;
    const observed = { x: squad.operation!.objective.x, z: squad.operation!.objective.z };
    player.transform.x += 170;
    vi.spyOn(vision, 'isVisibleWorld').mockReturnValue(false);
    expect(control.operationTarget(squad)).toEqual(observed);
  });

  it('keeps coordinated planning and escort assignments deterministic', () => {
    const first = fixture(), second = fixture();
    for (let i = 0; i < 12; i++) {
      first.control.commandSquads(); second.control.commandSquads();
      first.sim.tick += 150; second.sim.tick += 150;
    }
    expect(hashSim(first.sim)).toBe(hashSim(second.sim));
    expect(first.commander.stats).toEqual(second.commander.stats);
  });
});
