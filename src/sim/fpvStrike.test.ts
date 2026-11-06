import { describe,expect,it } from 'vitest';
import { applyUkraineProfile } from '../content/ukraine';
import { createGameSim,spawnWaspAt,spawnTankAt,stepSim,hashSim } from './world';
import { generateHeightfield } from './heightfield';
import { manualFireAt,stepCombat,issueAttackOrder } from './combat';
import { createEconomy } from './economy';
import { purchaseUnitUpgrade,upgradeOptionsForKind } from './upgrades';
import { serializeSim,restoreSerializedSim } from './serialize';
function fixture(){
 const hf=generateHeightfield({cells:128,cellSize:2,waterLevel:-100,seed:41,oreFieldCount:0});hf.heights.fill(10);hf.walkable.fill(1);
 const sim=createGameSim(hf);sim.rules.autoCombat=false;
 const drone=spawnWaspAt(sim,hf,-40,0,'FPV',1);applyUkraineProfile(drone,'wasp');drone.transform.y=35;
 const target=spawnTankAt(sim,35,0,'Target',2);target.health={current:1000,max:1000};
 return{hf,sim,drone,target};
}
describe('single-use FPV strike',()=>{
 it('flies the actual vulnerable drone to one impact, without a rocket or repeat shot',()=>{
  const{hf,sim,drone,target}=fixture();drone.playerControlled={throttle:0,turn:0,aimYaw:Math.PI/2};
  expect(manualFireAt(sim,drone,35,0,'primary',11,target.id,undefined,30)).toBe(true);
  expect(sim.projectiles).toHaveLength(0);expect(drone.destroyed).toBeUndefined();
  expect(manualFireAt(sim,drone,35,0,'primary')).toBe(false);
  for(let i=0;i<15;i++){stepSim(sim,hf,1/30);stepCombat(sim,1/30,{autoFire:false});}
  expect(drone.transform.x).toBeGreaterThan(-30);expect(target.health!.current).toBe(1000);
  for(let i=0;i<90;i++){stepSim(sim,hf,1/30);stepCombat(sim,1/30,{autoFire:false});}
  expect(target.health!.current).toBeLessThan(1000);expect(target.health!.current).toBeGreaterThan(900);
  expect(drone.health!.current).toBe(0);expect(sim.events.filter(e=>e.weaponKind==='fpvStrike')).toHaveLength(1);
  const hp=target.health!.current;for(let i=0;i<120;i++)stepCombat(sim,1/30,{autoFire:false});expect(target.health!.current).toBe(hp);
 });
 it('accepts ground attack orders and refuses aircraft, strategic locks and remote targets',()=>{
  const{sim,hf,drone,target}=fixture();const air=spawnWaspAt(sim,hf,35,0,'Enemy aircraft',2);
  expect(issueAttackOrder(sim,[drone],air)).toBe(false);
  expect(manualFireAt(sim,drone,35,0,'primary',35,air.id)).toBe(false);
  expect(manualFireAt(sim,drone,180,0,'primary')).toBe(false);
  expect(issueAttackOrder(sim,[drone],target)).toBe(true);
  stepCombat(sim,1/30);expect(drone.fpvDive?.targetId).toBe(target.id);expect(sim.projectiles).toHaveLength(0);
 });
 it('cannot inflict its strike after being shot down before contact',()=>{
  const{sim,drone,target}=fixture();expect(manualFireAt(sim,drone,35,0,'primary')).toBe(true);
  drone.health!.current=0;drone.destroyed={remaining:20};
  for(let i=0;i<180;i++)stepCombat(sim,1/30,{autoFire:false});
  expect(target.health!.current).toBe(1000);expect(sim.events.some(e=>e.weaponKind==='fpvStrike')).toBe(false);
 });
 it('preserves a committed dive through saves and includes its state in synchronization hashes',()=>{
  const{sim,hf,drone}=fixture();manualFireAt(sim,drone,35,0,'primary');const hash=hashSim(sim),state=serializeSim(sim);
  drone.fpvDive!.x+=1;expect(hashSim(sim)).not.toBe(hash);
  restoreSerializedSim(sim,hf,state);expect(hashSim(sim)).toBe(hash);expect(sim.byId.get(drone.id)?.fpvDive).toMatchObject({x:35,z:0});
 });
 it('cannot regain rocket fire through an inherited upgrade',()=>{
  const{sim,drone}=fixture();const economy=createEconomy(1,5000,'drone-network');
  expect(upgradeOptionsForKind('wasp',drone).some(d=>d.id==='needle-storm')).toBe(false);
  expect(purchaseUnitUpgrade(sim,economy,[drone.id],'needle-storm').ok).toBe(false);
  drone.specialWeapon={kind:'swarmRocket',range:140,cooldown:0};expect(manualFireAt(sim,drone,35,0,'special')).toBe(false);
 });
 it('migrates an old reusable missile profile without repeatedly weakening the hull',()=>{
  const{drone}=fixture();const hp=drone.health!.max;drone.weapon!.kind='aaMissile';
  applyUkraineProfile(drone,'wasp');applyUkraineProfile(drone,'wasp');
  expect(drone.weapon!.kind).toBe('fpvStrike');expect(drone.health!.max).toBe(hp);
 });
});
