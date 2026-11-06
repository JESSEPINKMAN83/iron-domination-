import {afterEach,describe,expect,it,vi} from 'vitest';
import {beginAssault,addAssaultMembers,failedAssault,deterrencePressure,opponentPenalty} from './deterrence';
import {EnemyCommander} from './commander';
import {createGameSim,spawnTankAt,hashSim} from '../sim/world';
import {generateHeightfield} from '../sim/heightfield';
import {createEconomy,createInitialBase} from '../sim/economy';
import {VisibilityGrid} from '../sim/visibility';
import {serializeSim,restoreSerializedSim} from '../sim/serialize';
import {manualFireAt,stepCombat} from '../sim/combat';
import type {Entity} from '../sim/components';
function fixture(){
 vi.spyOn(console,'info').mockImplementation(()=>{});
 const hf=generateHeightfield({cells:256,cellSize:2,waterLevel:-100,seed:41,oreFieldCount:0});hf.heights.fill(10);hf.walkable.fill(1);
 const sim=createGameSim(hf);sim.rules.allianceSides={1:1,2:2,3:3,4:4};sim.rules.autoCombat=false;
 const economy=createEconomy(2,10000),base=createInitialBase(sim,hf,economy,-140,0),vision=new VisibilityGrid(hf,2);
 const commander=new EnemyCommander(sim,hf,economy,vision,'rusher','hard',[{team:1,x:100,z:0},{team:3,x:140,z:60}]);
 const control=commander as unknown as {elapsed:number;squads:any[];commandSquads():void;pickTarget(squad:any):{entity?:Entity};resetSquadStrength(squad:any):void};
 control.elapsed=200;return{hf,sim,economy,base,vision,commander,control};
}
afterEach(()=>vi.restoreAllMocks());
describe('opponent deterrence',()=>{
 it('recognizes a wipe without meaningful damage and attributes it to the actual defender',()=>{
  const{sim}=fixture(),units=Array.from({length:5},(_,i)=>spawnTankAt(sim,-30,i*10,'Wave',2));
  const battle=beginAssault(units);
  for(const unit of units){unit.battleRecord={dealt:{1:2},received:{3:unit.health!.current}};unit.health!.current=0;unit.destroyed={remaining:0};sim.world.remove(unit);}
  expect(failedAssault(battle)?.team).toBe(3);battle.reported=true;expect(failedAssault(battle)).toBeUndefined();
 });
 it('does not call an effective exchange, scouting trip or old damage a crushing defeat',()=>{
  const{sim}=fixture(),unit=spawnTankAt(sim,0,0,'Wave',2);unit.battleRecord={dealt:{1:1000},received:{1:1000}};
  const battle=beginAssault([unit]);expect(failedAssault(battle)).toBeUndefined();
  unit.health!.current=0;expect(failedAssault(battle)).toBeUndefined();
  unit.battleRecord.received[1]+=unit.health!.max;unit.battleRecord.dealt[1]+=unit.health!.max;expect(failedAssault(battle)).toBeUndefined();
 });
 it('learns before a wiped-out squad is pruned and switches to a different visible army',()=>{
  const{sim,base,vision,control}=fixture();vi.spyOn(vision,'isEntityVisible').mockReturnValue(true);
  const wave=Array.from({length:5},(_,i)=>spawnTankAt(sim,-30,i*8,'Wave',2));
  const squad={units:wave,state:'attacking',nextOrderAt:0,maneuver:'direct'};control.resetSquadStrength(squad);control.squads.push(squad);
  for(const unit of wave){unit.battleRecord={dealt:{1:1},received:{1:unit.health!.current}};unit.health!.current=0;unit.destroyed={remaining:1};}
  control.commandSquads();expect(base.aiDeterrence?.[1].failures).toBe(1);
  const near=spawnTankAt(sim,0,0,'Defender',1),other=spawnTankAt(sim,80,30,'Other enemy',3),fresh=spawnTankAt(sim,-40,0,'Scout',2);
  expect(control.pickTarget({units:[fresh],state:'attacking',maneuver:'direct',nextOrderAt:0}).entity).toBe(other);
  // No fog cheat: the other army is no longer eligible when hidden.
  vi.mocked(vision.isEntityVisible).mockImplementation(e=>e!==other);
  const scout=control.pickTarget({units:[fresh],state:'attacking',maneuver:'direct',nextOrderAt:0});
  expect(scout.entity).toBeUndefined();expect(scout).toMatchObject({x:140,z:60});
 });
 it('waits after a defeat and launches a larger force when there is no alternative',()=>{
  const{sim,base,control}=fixture();sim.rules.allianceSides={1:1,2:2};
  base.aiDeterrence={1:{failures:1,tick:0,requiredHp:1000}};
  for(let i=0;i<12;i++)spawnTankAt(sim,-100+i*5,30,'Reserve',2);
  control.commandSquads();expect(control.squads).toHaveLength(0);
  sim.tick=30*100;control.commandSquads();expect(control.squads[0].units.filter((e:Entity)=>!e.flight).length).toBeGreaterThan(5);
 });
 it('reduces caution for a prepared strike and fades memory rather than causing permanent passivity',()=>{
  const memory={failures:2,tick:0,requiredHp:1000};expect(opponentPenalty(memory,3000,1600)).toBeLessThan(opponentPenalty(memory,3000,500));
  expect(deterrencePressure(memory,30*481)).toBe(0);
 });
 it('includes late escorts and excludes their earlier combat when judging a wave',()=>{
  const{sim}=fixture(),ground=Array.from({length:5},(_,i)=>spawnTankAt(sim,i*10,0,'Wave',2)),escort=spawnTankAt(sim,0,30,'Late escort',2);
  escort.battleRecord={dealt:{1:1000},received:{}};
  const battle=beginAssault(ground);addAssaultMembers(battle,[escort]);addAssaultMembers(battle,[escort]);expect(battle.members).toHaveLength(6);
  for(const unit of ground){unit.battleRecord={dealt:{},received:{1:unit.health!.current}};unit.health!.current=0;unit.destroyed={remaining:1};}
  expect(failedAssault(battle)?.team).toBe(1);
  escort.battleRecord.dealt[1]+=1000;expect(failedAssault(battle)).toBeUndefined();
 });
 it('saves and hashes opponent memory and combat exchanges',()=>{
  const{sim,hf,base}=fixture();base.aiDeterrence={1:{failures:1,tick:3,requiredHp:1000}};base.battleRecord={dealt:{1:10},received:{}};
  const directionHash=hashSim(sim);base.battleRecord={dealt:{},received:{1:10}};expect(hashSim(sim)).not.toBe(directionHash);
  const hash=hashSim(sim),state=serializeSim(sim);base.aiDeterrence[1].failures=2;expect(hashSim(sim)).not.toBe(hash);
  restoreSerializedSim(sim,hf,state);expect(hashSim(sim)).toBe(hash);expect(sim.byId.get(base.id)?.aiDeterrence?.[1].failures).toBe(1);
 });
 it('records real damage exchanges from combat without needing global enemy strength',()=>{
  const{sim}=fixture();const attacker=spawnTankAt(sim,-20,0,'Attacker',2),target=spawnTankAt(sim,20,0,'Target',1);
  attacker.playerControlled={throttle:0,turn:0,aimYaw:Math.PI/2};attacker.turret!.yaw=Math.PI/2;
  manualFireAt(sim,attacker,20,0,'primary',11,target.id);
  for(let i=0;i<100;i++)stepCombat(sim,1/30,{autoFire:false});
  expect(attacker.battleRecord?.dealt[1]).toBeGreaterThan(0);expect(target.battleRecord?.received[2]).toBe(attacker.battleRecord?.dealt[1]);
 });
});
