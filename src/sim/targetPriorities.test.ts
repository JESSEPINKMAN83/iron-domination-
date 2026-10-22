import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import type { Entity } from './components';
import { stepCombat } from './combat';
import { generateHeightfield } from './heightfield';
import { createGameSim, hashSim, issueMoveOrder, spawnTankAt, spawnVultureAt, spawnSiegeTankAt, stepSim } from './world';
import { cloneTacticPlan, issueTacticOrder } from './tactics';
import { loadSerializedSim, serializeSim } from './serialize';
import { matchesTargetPriorities, normalizeTargetPriorities } from './targetPriorities';

function fixture(priorities: Parameters<typeof issueTacticOrder>[6] = ['economy']) {
  const hf = generateHeightfield(MAP01); hf.heights.fill(0); hf.walkable.fill(1);
  const sim = createGameSim(hf); sim.rules.autoCombat = false;
  const unit = spawnVultureAt(sim, hf, 0, 0, 'Route aircraft', 1);
  unit.weapons = undefined; unit.weapon = {kind:'cannon',range:120,cooldown:0}; unit.turret = undefined;
  unit.health!.current = unit.health!.max = 10000;
  unit.vision = {radius:150};
  const ordinary = spawnTankAt(sim, 15, 10, 'Incidental tank', 2);
  ordinary.weapon = undefined; ordinary.weapons = undefined;
  ordinary.health!.current = ordinary.health!.max = 10000;
  const target = sim.world.add({id:sim.nextEntityId++,team:{id:2},transform:{x:50,y:0,z:10,rot:0},previousTransform:{x:50,y:0,z:10,rot:0},health:{current:10000,max:10000},armor:{kind:'building'},building:{kind:'refinery',label:'Refinery',footprint:{w:4,h:4},powerProduced:0,powerUsed:0,complete:true,buildProgress:1}} as Entity);
  issueTacticOrder(sim,[unit],[{x:80,z:0},{x:160,z:0}],{kind:'attack-through'},false,0,priorities);
  return {hf,sim,unit,ordinary,target};
}

describe('tactic target priorities', () => {
  it('prefers a farther economy target and falls back when no priority is defined', () => {
    const preferred = fixture(); stepCombat(preferred.sim,1/30);
    expect(preferred.unit.weapon!.targetId).toBe(preferred.target.id);
    const normal = fixture([]); stepCombat(normal.sim,1/30);
    expect(normal.unit.weapon!.targetId).toBe(normal.ordinary.id);
  });
  it('switches away from an incidental target when a priority enters range, then falls back when it is destroyed', () => {
    const {sim,unit,ordinary,target} = fixture();
    target.transform.x = 250;
    stepCombat(sim,1/30); expect(unit.weapon!.targetId).toBe(ordinary.id);
    target.transform.x = 50;
    sim.tick = (6 - unit.id % 6) % 6;
    stepCombat(sim,1/30); expect(unit.weapon!.targetId).toBe(target.id);
    target.health!.current = 0;
    stepCombat(sim,1/30); expect(unit.weapon!.targetId).toBe(ordinary.id);
  });
  it('never targets allies, out-of-vision priorities or aircraft its weapon cannot engage', () => {
    const {sim,unit,ordinary,target} = fixture();
    target.team!.id = 1;
    stepCombat(sim,1/30); expect(unit.weapon!.targetId).toBe(ordinary.id);
    target.team!.id = 2; target.transform.x = 200;
    stepCombat(sim,1/30); expect(unit.weapon!.targetId).toBe(ordinary.id);
    const air = spawnVultureAt(sim,sim.nav.heightfield,30,0,'Enemy aircraft',2);
    unit.mover!.tactic!.targetPriorities = ['aircraft'];
    unit.weapon!.targetId = undefined;
    stepCombat(sim,1/30); expect(unit.weapon!.targetId).toBe(ordinary.id);
    expect(unit.weapon!.targetId).not.toBe(air.id);
  });
  it('completes the complete route while firing at mission targets, without chasing or stopping', () => {
    const {hf,sim,unit,target} = fixture();
    let preferredHits = 0;
    for(let i=0;i<1200&&unit.mover!.tactic;i++) {
      stepSim(sim,hf,1/30); stepCombat(sim,1/30);
      preferredHits += sim.events.filter(e=>e.targetId===target.id&&e.damage>0).length;
      if(unit.mover!.tactic) expect(Math.hypot(unit.velocity!.x,unit.velocity!.z)).toBeGreaterThan(0.1);
      sim.events.length=0;
    }
    expect(preferredHits).toBeGreaterThan(0);
    expect(unit.mover!.tactic).toBeUndefined();
    expect(unit.mover!.holdPosition).toEqual({x:160,z:0});
  });
  it('preserves independent choices through waypoints, formation clones and saves, and clears them on a new move', () => {
    const {hf,sim,unit} = fixture(['economy','missile-sites']);
    const cloned = cloneTacticPlan(unit.mover!.tactic!);
    cloned.targetPriorities!.push('aircraft');
    expect(unit.mover!.tactic!.targetPriorities).toEqual(['economy','missile-sites']);
    const hash = hashSim(sim);
    unit.mover!.tactic!.targetPriorities=['aircraft'];
    expect(hashSim(sim)).not.toBe(hash);
    const saved=loadSerializedSim(hf,serializeSim(sim));
    expect(saved.byId.get(unit.id)!.mover!.tactic!.targetPriorities).toEqual(['aircraft']);
    unit.mover!.tactic!.targetPriorities=['economy','missile-sites'];
    for(let i=0;i<600 && unit.mover!.tactic?.remaining.length;i++) stepSim(sim,hf,1/30);
    expect(unit.mover!.tactic!.targetPriorities).toEqual(['economy','missile-sites']);
    issueMoveOrder(sim,[unit],200,0);
    expect(unit.mover!.tactic).toBeUndefined();
  });
  it('classifies real weapons, upgraded anti-air defenses, collectors and missile infrastructure', () => {
    const {sim,target} = fixture();
    expect(matchesTargetPriorities(target,['economy'])).toBe(true);
    target.building!.kind='strategic-silo'; expect(matchesTargetPriorities(target,['missile-sites'])).toBe(true);
    target.building!.kind='intelligence-center'; expect(matchesTargetPriorities(target,['missile-sites'])).toBe(true);
    target.building!.kind='guard-tower'; expect(matchesTargetPriorities(target,['anti-air'])).toBe(false);
    target.building!.airDefenseWeapon={kind:'aaMissile',range:100,cooldown:0};
    expect(matchesTargetPriorities(target,['anti-air'])).toBe(true);
    const artillery=spawnSiegeTankAt(sim,30,30,'Fajr launcher',2);
    expect(matchesTargetPriorities(artillery,['artillery'])).toBe(true);
    expect(matchesTargetPriorities({...artillery,harvester:{} as Entity['harvester']},['economy'])).toBe(true);
  });
  it('normalizes duplicate and unknown wire values deterministically', () => {
    expect(normalizeTargetPriorities(['missile-sites','economy','economy','not-a-type'])).toEqual(['economy','missile-sites']);
    expect(normalizeTargetPriorities('economy')).toBeUndefined();
    expect(normalizeTargetPriorities([])).toBeUndefined();
  });
});
