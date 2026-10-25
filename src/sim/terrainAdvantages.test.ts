import { spawnInfantryAt } from './economy';
import { describe,expect,it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { createGameSim,spawnTankAt,stepSim,issueMoveOrder,hashSim } from './world';
import { groundSpeedMultiplier,effectiveSight,infantryConcealed,canDetectTerrainTarget,terrainCell,TERRAIN_REVEAL_TICKS } from './terrainAdvantages';
import { VisibilityGrid } from './visibility';
import { issueAttackOrder,stepCombat } from './combat';
import { serializeSim,loadSerializedSim } from './serialize';

function fixture() {
  const hf=generateHeightfield({...MAP01,seed:41});hf.heights.fill(10);hf.walkable.fill(1);
  hf.terrainAdvantages!.roads.fill(0);hf.terrainAdvantages!.woodland.fill(0);hf.terrainAdvantages!.sight.fill(1);
  const sim=createGameSim(hf);return {hf,sim};
}
describe('terrain advantages',()=>{
  it('generates the same visible road and woodland grids for the same map seed',()=>{
    const a=generateHeightfield({...MAP01,seed:41}), b=generateHeightfield({...MAP01,seed:41});
    expect(a.terrainAdvantages).toEqual(b.terrainAdvantages);
    expect(a.terrainAdvantages!.roads.some(Boolean)).toBe(true);
    expect(a.terrainAdvantages!.woodland.some(Boolean)).toBe(true);
    for(let i=0;i<a.walkable.length;i++) if(!a.walkable[i]) expect(a.terrainAdvantages!.roads[i]).toBe(0);
  });
  it('makes ground units faster on roads in RTS movement without changing aircraft',()=>{
    const normal=fixture(), road=fixture();road.hf.terrainAdvantages!.roads.fill(1);
    const a=spawnTankAt(normal.sim,0,0,'Offroad',1),b=spawnTankAt(road.sim,0,0,'Road',1);
    issueMoveOrder(normal.sim,[a],0,150);issueMoveOrder(road.sim,[b],0,150);
    for(let i=0;i<60;i++){stepSim(normal.sim,normal.hf,1/30);stepSim(road.sim,road.hf,1/30);}
    expect(b.transform.z).toBeGreaterThan(a.transform.z*1.15);
    expect(groundSpeedMultiplier(road.hf,{...b,flight:{} as never})).toBe(1);
  });
  it('caps high ground sight bonus and leaves weapon range unchanged',()=>{
    const {hf,sim}=fixture(),unit=spawnTankAt(sim,0,0,'Ridge',1);
    hf.terrainAdvantages!.sight[terrainCell(hf,0,0)]=1.25;
    const range=unit.weapon!.range;
    expect(effectiveSight(hf,unit)).toBe(unit.vision!.radius*1.25);
    expect(unit.weapon!.range).toBe(range);
  });
  it('hides woodland infantry at distance, reveals nearby and after firing, and preserves allies',()=>{
    const {hf,sim}=fixture();hf.terrainAdvantages!.woodland.fill(1);
    const observer=spawnTankAt(sim,0,0,'Observer',1);observer.vision!.radius=100;
    const enemy=spawnInfantryAt(sim,0,75,2,'infantry');
    const fog=new VisibilityGrid(hf,1);fog.update(sim);
    expect(fog.isVisibleWorld(0,75)).toBe(true);
    expect(fog.isEntityVisible(enemy,sim.tick)).toBe(false);
    expect(canDetectTerrainTarget(hf,observer,enemy,sim.tick)).toBe(false);
    enemy.transform.z=20;fog.update(sim);expect(fog.isEntityVisible(enemy,sim.tick)).toBe(true);
    enemy.transform.z=75;enemy.terrainRevealedUntilTick=sim.tick+TERRAIN_REVEAL_TICKS;
    expect(fog.isEntityVisible(enemy,sim.tick)).toBe(true);
    expect(infantryConcealed(hf,enemy,TERRAIN_REVEAL_TICKS)).toBe(true);
    enemy.team!.id=1;expect(fog.isEntityVisible(enemy,sim.tick)).toBe(true);
  });
  it('blocks automatic targeting of concealed infantry and exposes a firing infantry unit',()=>{
    const {hf,sim}=fixture();hf.terrainAdvantages!.woodland.fill(1);
    const observer=spawnTankAt(sim,0,0,'Observer',1);observer.vision!.radius=100;
    const enemy=spawnInfantryAt(sim,0,75,2,'infantry');
    expect(issueAttackOrder(sim,[observer],enemy)).toBe(false);
    enemy.transform.z=15;enemy.transform.y=10;observer.weapon!.cooldown=100;
    const opponent=spawnInfantryAt(sim,0,0,1,'infantry');opponent.transform.y=10;opponent.weapon!.cooldown=100;
    enemy.turret!.yaw=Math.PI;
    enemy.mover!.attackMove=true;stepCombat(sim,1/30);
    expect(enemy.terrainRevealedUntilTick).toBeGreaterThan(sim.tick);
  });
  it('serializes and hashes firing exposure for multiplayer recovery',()=>{
    const {hf,sim}=fixture();const unit=spawnInfantryAt(sim,0,0,1,'infantry');
    const before=hashSim(sim);unit.terrainRevealedUntilTick=180;expect(hashSim(sim)).not.toBe(before);
    const restored=loadSerializedSim(hf,serializeSim(sim));expect(hashSim(restored)).toBe(hashSim(sim));
    expect(restored.byId.get(unit.id)!.terrainRevealedUntilTick).toBe(180);
  });
});
