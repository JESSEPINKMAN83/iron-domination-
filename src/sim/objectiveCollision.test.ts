import { describe,expect,it } from 'vitest';
import { MAP01 } from '../content/map01';
import { createEconomy,spawnInfantryAt } from './economy';
import { generateHeightfield } from './heightfield';
import { seedObjectives,stepObjectives,outsideObjectiveFootprint } from './objectives';
import { createGameSim,issueMoveOrder,spawnTankAt,stepSim } from './world';
import { serializeSim,loadSerializedSim } from './serialize';
function fixture(index:number) {
  const hf=generateHeightfield(MAP01);hf.heights.fill(10);hf.walkable.fill(1);hf.waterLevel=0;
  const sim=createGameSim(hf), site=seedObjectives(sim,hf)[index];
  return {hf,sim,site};
}
describe('solid capture-site structures',()=>{
  it.each([0,1,2])('site %i blocks infantry and tanks from both armies while permitting detours', index=>{
    for(const team of [1,2])for(const infantry of [false,true]) {
      const {sim,hf,site}=fixture(index), {x,z}=site.transform;
      const unit=infantry?spawnInfantryAt(sim,x-40,z,team,'infantry'):spawnTankAt(sim,x-40,z,'Tank',team);
      expect(issueMoveOrder(sim,[unit],x+40,z)).toBe(true);
      for(let i=0;i<600;i++) {
        stepSim(sim,hf,1/30);
        expect(outsideObjectiveFootprint(unit,site)).toBe(true);
      }
      expect(unit.transform.x).toBeGreaterThan(x+35);
    }
  });
  it.each([0,1,2])('clicking the center of site %i parks outside its structure and still captures',index=>{
    const {sim,hf,site}=fixture(index), {x,z}=site.transform;
    const unit=spawnTankAt(sim,x-40,z,'Capture',1), economy=createEconomy(1);
    expect(issueMoveOrder(sim,[unit],x,z)).toBe(true);
    for(let i=0;i<700;i++) { stepSim(sim,hf,1/30);stepObjectives(sim,[economy]);expect(outsideObjectiveFootprint(unit,site)).toBe(true); }
    expect(site.objective!.ownerTeam).toBe(1);
    expect(unit.mover!.target).toBeUndefined();
    expect(Math.hypot(unit.transform.x-x,unit.transform.z-z)).toBeLessThan(25);
  });
  it('repairs collision in older saves and moves enclosed units out without damage',()=>{
    const {sim,hf,site}=fixture(0);
    const unit=spawnTankAt(sim,site.transform.x,site.transform.z,'Legacy enclosed unit',1);
    stepObjectives(sim,[createEconomy(1)]);expect(site.objective!.captureTicks).toBe(0);
    const saved=serializeSim(sim);saved.dynamicBlockers=[];
    const restored=loadSerializedSim(hf,saved), loaded=restored.byId.get(unit.id)!;
    stepSim(restored,hf,1/30);
    expect(outsideObjectiveFootprint(loaded,site)).toBe(true);
    expect(loaded.health!.current).toBe(unit.health!.current);
  });
  it('blocks boosted direct control too',()=>{
    const {sim,hf,site}=fixture(0), {x,z}=site.transform;
    const unit=spawnTankAt(sim,x-40,z,'Fast controlled tank',1);
    unit.transform.rot=Math.PI/2;unit.mover!.speed=200;
    unit.playerControlled={throttle:1,turn:0,aimYaw:Math.PI/2,boost:true};
    stepSim(sim,hf,0.25);expect(outsideObjectiveFootprint(unit,site)).toBe(true);expect(unit.transform.x).toBeLessThan(x-9);
  });
});
