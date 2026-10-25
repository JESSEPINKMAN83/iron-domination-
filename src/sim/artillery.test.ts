import { describe,expect,it,vi } from 'vitest';
import { MAP01 } from '../content/map01';
import { UNITS } from '../content/phase3';
import { generateHeightfield } from './heightfield';
import { createGameSim,spawnArtilleryAt,spawnTankAt,stepSim,hashSim,issueMoveOrder } from './world';
import { manualFireAt,stepCombat } from './combat';
import { setArtilleryDeployment } from './artillery';
import { loadSerializedSim,serializeSim } from './serialize';
import { createEconomy,createInitialBase } from './economy';
import { VisibilityGrid } from './visibility';
import { EnemyCommander } from '../ai/commander';

function fixture(team=1) {
  const hf=generateHeightfield({...MAP01,seed:41}); hf.heights.fill(10); hf.walkable.fill(1);
  const sim=createGameSim(hf);
  const gun=spawnArtilleryAt(sim,0,0,'Field gun',team); gun.turret!.yaw=0;
  const tick=(count:number)=>{for(let i=0;i<count;i++)stepSim(sim,hf,1/30);};
  return {hf,sim,gun,tick};
}

describe('deployable artillery',()=>{
  it.each([1,2])('requires the complete 15-second setup for army %s',team=>{
    const {sim,gun,tick}=fixture(team);
    expect(UNITS.artillery.doctrine).toBeUndefined();
    expect(manualFireAt(sim,gun,0,250)).toBe(false);
    tick(449); expect(gun.artillery!.phase).toBe('deploying');
    expect(manualFireAt(sim,gun,0,250)).toBe(false);
    tick(1); expect(gun.artillery!.phase).toBe('deployed');
    gun.turret!.yaw=0;
    expect(manualFireAt(sim,gun,0,250)).toBe(true);
    expect(gun.weapon!.cooldown).toBe(8.5);
    expect(manualFireAt(sim,gun,0,250)).toBe(false);
  });

  it('rejects close targets and shots beyond its maximum range',()=>{
    const {sim,gun,tick}=fixture(); tick(450);
    expect(manualFireAt(sim,gun,0,40)).toBe(false);
    expect(manualFireAt(sim,gun,0,440)).toBe(false);
    expect(sim.projectiles).toHaveLength(0);
    expect(gun.weapon!.cooldown).toBe(0);
  });

  it('packs for five seconds before obeying a movement order',()=>{
    const {sim,gun,tick}=fixture();tick(450);
    issueMoveOrder(sim,[gun],80,0);
    const start={...gun.transform};tick(149);
    expect(gun.artillery!.phase).toBe('packing');
    expect(gun.transform.x).toBeCloseTo(start.x);
    expect(manualFireAt(sim,gun,0,250)).toBe(false);
    tick(20);expect(gun.artillery!.phase).toBe('mobile');
    expect(Math.hypot(gun.transform.x-start.x,gun.transform.z-start.z)).toBeGreaterThan(0);
  });

  it('cancels setup on a pack request and preserves deployment through snapshots',()=>{
    const {hf,sim,gun,tick}=fixture();tick(120);
    const hash=hashSim(sim),saved=serializeSim(sim),restored=loadSerializedSim(hf,saved);
    expect(hashSim(restored)).toBe(hash);
    expect([...restored.world.entities].find(e=>e.artillery)?.artillery).toEqual(gun.artillery);
    gun.artillery!.elapsed+=1;expect(hashSim(sim)).not.toBe(hash);
    setArtilleryDeployment(gun,false);tick(1);expect(gun.artillery!.phase).toBe('mobile');
  });

  it('uses a ground-impact arc with meaningful splash damage at long range',()=>{
    const {sim,gun,tick}=fixture();tick(450);
    const target=spawnTankAt(sim,0,250,'Target',2);
    const hp=target.health!.current;gun.turret!.yaw=0;
    expect(manualFireAt(sim,gun,0,250)).toBe(true);
    expect(sim.projectiles[0].trajectory).toBe('arc');
    for(let i=0;i<300;i++)stepCombat(sim,1/30,{autoFire:false});
    expect(target.health!.current).toBeLessThan(hp-50);
    expect(gun.health!.max).toBe(125);
  });

  it.each(['iron-legion','missile-command'] as const)('positions and protects %s artillery, and retreats a damaged gun',doctrine=>{
    const {hf,sim,gun}=fixture(2);
    const economy=createEconomy(2,6000,doctrine);
    createInitialBase(sim,hf,economy,-120,-120);
    const vision=new VisibilityGrid(hf,2);vi.spyOn(vision,'isVisibleWorld').mockReturnValue(true);
    const escort=spawnTankAt(sim,10,10,'Escort',2);
    spawnTankAt(sim,0,200,'Enemy',1);
    const commander=new EnemyCommander(sim,hf,economy,vision,'balanced','hard');
    const control=commander as unknown as {commandArtillery():void;nextVehicleKind(count:number):string};
    expect(control.nextVehicleKind(4)).toBe('artillery');
    control.commandArtillery();
    expect(gun.artillery!.deploy).toBe(true);expect(gun.weapon!.targetId).toBeDefined();
    expect(escort.mover!.artilleryEscort).toBe(gun.id);
    gun.health!.current=20;control.commandArtillery();
    expect(gun.artillery!.deploy).toBe(false);expect(gun.mover!.target).toBeDefined();
    vi.restoreAllMocks();
  });
});
