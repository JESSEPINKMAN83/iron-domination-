import { describe, expect, it } from 'vitest';
import { doctrineAllows, sanitizeArmyDoctrines } from './armyDoctrines';
import { nationsForDoctrines } from './nations';
import { applyUSAProfile, spawnUSSpecialist, USA_SPECIALISTS } from './usa';
import { UNITS } from './phase3';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim, spawnHammerheadAt, spawnTankAt } from '../sim/world';
import { createEconomy, createInitialBase, queueUnit, stepEconomy } from '../sim/economy';
import { manualFireAt, stepCombat, canManualWeaponLockTarget } from '../sim/combat';
import { serializeSim, restoreSerializedSim } from '../sim/serialize';
import { unitKindForUpgrade } from '../sim/upgrades';
import { VisibilityGrid } from '../sim/visibility';
import { EnemyCommander } from '../ai/commander';

function fixture() {
  const hf=generateHeightfield({cells:256,cellSize:2,waterLevel:-100,seed:41,oreFieldCount:0});
  hf.heights.fill(10);hf.walkable.fill(1);
  const sim=createGameSim(hf);sim.rules.autoCombat=false;
  return {hf,sim};
}
describe('USA faction integration',()=>{
  it('preserves the fourth faction in settings and reserves its specialists',()=>{
    expect(sanitizeArmyDoctrines(['expeditionary-force'])?.[0]).toBe('expeditionary-force');
    expect(nationsForDoctrines(['expeditionary-force','drone-network','iron-legion','missile-command'])).toEqual(['usa','ukraine','israel','iran']);
    for(const kind of USA_SPECIALISTS){
      expect(doctrineAllows(UNITS[kind].doctrine,'expeditionary-force',kind)).toBe(true);
      for(const other of ['iron-legion','drone-network','missile-command'] as const)expect(doctrineAllows(UNITS[kind].doctrine,other,kind)).toBe(false);
    }
    expect(doctrineAllows('iron-legion','expeditionary-force','aa-tower')).toBe(true);
    expect(doctrineAllows('iron-legion','expeditionary-force','missile-defense')).toBe(false);
  });
  it('builds every specialist with its correct weapons and saves its identity',()=>{
    const {hf,sim}=fixture(), economy=createEconomy(1,30000,'expeditionary-force');
    const base=createInitialBase(sim,hf,economy,0,0);
    for(const [kind,tab,x] of [['factory','vehicles',45],['helipad','aircraft',-45]] as const){
      sim.world.add({...base,id:sim.nextEntityId++,transform:{x,z:0,rot:0},previousTransform:{x,z:0,rot:0},building:{...base.building!,kind,complete:true,powerProduced:100,powerUsed:0},producer:{tab,queue:[]}});
    }
    for(const kind of USA_SPECIALISTS){
      expect(queueUnit(sim,economy,kind)).toBe(true);
      const unit=stepEconomy(sim,hf,economy,UNITS[kind].buildTime+1).find(e=>e.rosterKind===kind);
      expect(unit,kind).toBeDefined();expect(unitKindForUpgrade(unit!)).toBe(kind);
      const hp=unit!.health!.max;applyUSAProfile(unit!,kind);expect(unit!.health!.max).toBe(hp);
    }
    restoreSerializedSim(sim,hf,serializeSim(sim));
    expect([...sim.world.entities].filter(e=>e.usaProfile).map(e=>e.rosterKind)).toEqual(expect.arrayContaining([...USA_SPECIALISTS]));
  });
  it('delivers both heavy bombs with real damage and caps manual range',()=>{
    const {hf,sim}=fixture();const bomber=spawnUSSpecialist(sim,hf,0,0,1,'bomber');
    bomber.playerControlled={throttle:0,turn:0,aimYaw:Math.PI/2};
    const target=spawnTankAt(sim,70,0,'Target',2);target.health={current:1000,max:1000};
    // Conventional free-fall bombs are aimed at ground coordinates, not seeker locks.
    expect(canManualWeaponLockTarget('heavyBomb',target)).toBe(false);
    expect(manualFireAt(sim,bomber,70,0,'primary')).toBe(true);
    expect(sim.projectiles).toHaveLength(2);expect(sim.projectiles.every(p=>p.weaponKind==='heavyBomb')).toBe(true);
    for(let i=0;i<300;i++)stepCombat(sim,1/30,{autoFire:false});
    expect(target.health.current).toBeLessThan(800);
    bomber.weapon!.cooldown=0;expect(manualFireAt(sim,bomber,450,0,'primary')).toBe(true);
    expect(sim.projectiles.every(p=>Math.hypot(p.toX,p.toZ)<=175.01)).toBe(true);
    const air=spawnHammerheadAt(sim,hf,30,0,'Air target',2);expect(canManualWeaponLockTarget('heavyBomb',air)).toBe(false);
  });
  it('fires three staggered MLRS rockets and refuses point-blank fire',()=>{
    const {hf,sim}=fixture();const mlrs=spawnUSSpecialist(sim,hf,0,0,1,'mlrs');
    mlrs.playerControlled={throttle:0,turn:0,aimYaw:Math.PI/2};mlrs.turret!.yaw=Math.PI/2;
    expect(manualFireAt(sim,mlrs,30,0,'primary')).toBe(false);
    expect(manualFireAt(sim,mlrs,150,0,'primary')).toBe(true);
    expect(sim.projectiles).toHaveLength(3);expect(new Set(sim.projectiles.map(p=>p.launchDelay)).size).toBe(3);
  });
  it('lets US AI choose the expanded ground and air roster',()=>{
    const {hf,sim}=fixture(),economy=createEconomy(2,10000,'expeditionary-force');
    createInitialBase(sim,hf,economy,0,0);
    const commander=new EnemyCommander(sim,hf,economy,new VisibilityGrid(hf,2),'balanced','extra-hard') as unknown as {nextVehicleKind:(i:number)=>string;nextAircraftKind:(i:number)=>string};
    expect(Array.from({length:6},(_,i)=>commander.nextVehicleKind(i))).toEqual(expect.arrayContaining(['bradley','mlrs']));
    expect(Array.from({length:5},(_,i)=>commander.nextAircraftKind(i))).toEqual(expect.arrayContaining(['strike-jet','bomber']));
  });
});
