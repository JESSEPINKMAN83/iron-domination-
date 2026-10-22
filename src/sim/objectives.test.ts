import { describe, expect, it } from 'vitest';
import { MAP01 } from '../content/map01';
import { generateHeightfield } from './heightfield';
import { createEconomy } from './economy';
import { createGameSim, hashSim, hashCriticalSimState, spawnTankAt, spawnVultureAt } from './world';
import { seedObjectives, stepObjectives, CAPTURE_TICKS } from './objectives';
import { serializeSim, loadSerializedSim } from './serialize';

function setup() {
  const hf=generateHeightfield(MAP01);hf.heights.fill(0);hf.walkable.fill(1);
  const sim=createGameSim(hf); const sites=seedObjectives(sim,hf);
  const economies=[createEconomy(1,1000),createEconomy(2,1000)];
  const site=sites[0];
  const unit=spawnTankAt(sim,site.transform.x+16,site.transform.z,'Capture',1);
  const tick=(n:number)=>{for(let i=0;i<n;i+=3){sim.tick+=3;stepObjectives(sim,economies);}};
  return {hf,sim,sites,site,unit,economies,tick};
}
describe('contested objectives',()=>{
  it('captures after eight seconds and grants radar vision without becoming a victory asset',()=>{
    const {sim,site,tick}=setup();tick(CAPTURE_TICKS-3);expect(site.objective!.ownerTeam).toBeUndefined();tick(3);
    expect(site.team?.id).toBe(1);expect(site.vision?.radius).toBe(180);expect(site.building).toBeUndefined();expect(site.health).toBeUndefined();
    expect(sim.objectivesQuery.size).toBe(3);
  });
  it('freezes capture under hostile ground presence and permits recapture',()=>{
    const {sim,site,unit,tick}=setup();tick(60);const before=site.objective!.captureTicks;
    const enemy=spawnTankAt(sim,site.transform.x+16,site.transform.z+4,'Contest',2);tick(300);
    expect(site.objective!.contested).toBe(true);expect(site.objective!.captureTicks).toBe(before);
    enemy.transform.x+=100;tick(180);expect(site.team?.id).toBe(1);
    unit.transform.x+=100;enemy.transform.x=site.transform.x+16;tick(240);expect(site.team?.id).toBe(2);
  });
  it('aircraft cannot capture and allied units do not contest or steal ownership',()=>{
    const {sim,hf,site,unit,tick}=setup();unit.transform.x+=100;
    spawnVultureAt(sim,hf,site.transform.x,site.transform.z,'Air',1);tick(300);expect(site.team).toBeUndefined();
    unit.transform.x=site.transform.x+16;tick(240);sim.rules.allianceSides[2]=1;
    spawnTankAt(sim,site.transform.x+16,site.transform.z,'Ally',2);tick(240);expect(site.team?.id).toBe(1);expect(site.objective!.contested).toBe(false);
  });
  it('oil pays exactly 100 credits per ten seconds and pauses while contested',()=>{
    const {sim,sites,unit,economies,tick}=setup();const oil=sites[2];unit.transform.x=oil.transform.x+16;unit.transform.z=oil.transform.z;
    tick(240);tick(297);expect(economies[0].credits).toBe(1100);
    spawnTankAt(sim,oil.transform.x+16,oil.transform.z,'Contest',2);tick(600);expect(economies[0].credits).toBe(1100);
  });
  it('supply repairs parked ground units without healing aircraft or moving units',()=>{
    const {sim,hf,sites,unit,tick}=setup();const supply=sites[1];unit.transform.x=supply.transform.x+16;unit.transform.z=supply.transform.z;tick(240);
    unit.health!.current=unit.health!.max*0.5; const initial=unit.health!.current;
    const air=spawnVultureAt(sim,hf,supply.transform.x,supply.transform.z,'Air',1);air.health!.current=10;
    tick(30);expect(unit.health!.current).toBeGreaterThan(initial);expect(air.health!.current).toBe(10);
    unit.mover!.target={x:300,z:300};const hp=unit.health!.current;tick(30);expect(unit.health!.current).toBe(hp);
  });
  it('requires real continuous occupation, not just a destination click',()=>{
    const {sim,site,unit,tick}=setup();
    unit.transform.x+=100;unit.mover!.target={x:site.transform.x,z:site.transform.z};
    tick(300);expect(site.objective!.captureTicks).toBe(0);expect(site.team).toBeUndefined();
    unit.transform.x=site.transform.x+16;tick(60);expect(site.objective!.capturingTeam).toBe(1);
    unit.transform.x+=100;tick(3);expect(site.objective!.captureTicks).toBe(0);expect(site.objective!.capturingTeam).toBeUndefined();
    unit.transform.x=site.transform.x+16;tick(237);expect(site.team).toBeUndefined();tick(3);expect(site.team?.id).toBe(1);
    unit.transform.x+=100;tick(30);expect(site.team?.id).toBe(1);
  });
  it('preserves capture and ownership across saves and hashes progress',()=>{
    const {sim,hf,site,tick}=setup();const before=hashSim(sim), critical=hashCriticalSimState(sim);tick(60);
    expect(hashSim(sim)).not.toBe(before);expect(hashCriticalSimState(sim)).not.toBe(critical);
    const restored=loadSerializedSim(hf,serializeSim(sim));expect(hashSim(restored)).toBe(hashSim(sim));
    expect(restored.objectivesQuery.size).toBe(3);expect(restored.byId.get(site.id)!.objective).toEqual(site.objective);
    tick(180);const owned=loadSerializedSim(hf,serializeSim(sim));expect(owned.byId.get(site.id)!.vision?.radius).toBe(180);
  });
});
