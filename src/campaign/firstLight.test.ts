import { describe,expect,it } from 'vitest';
import { mapConfig } from '../content/maps';
import { createEconomy,createInitialBase,buildings,canBuildStructure } from '../sim/economy';
import { generateHeightfield } from '../sim/heightfield';
import { createGameSim,hashSim } from '../sim/world';
import { startPosition } from '../content/startPositions';
import { serializeSim,loadSerializedSim } from '../sim/serialize';
import { FIRST_STRIKE_TICK,seedFirstLight,campaignState,stepFirstLight,campaignTargetsAlive } from './firstLight';
function fixture(){
 const hf=generateHeightfield({...mapConfig('highlands','medium',150,50,'classic'),seed:41});
 const sim=createGameSim(hf);sim.rules.allianceSides={1:1,2:2,3:2};
 const armies=[1,2,3].map(team=>{const economy=createEconomy(team,6500,team===1?'iron-legion':'missile-command'),p=startPosition(hf.size,[4,1,2][team-1]);return{team,economy,base:createInitialBase(sim,hf,economy,p.x,p.z)};});
 const units=seedFirstLight(sim,hf,armies),state=campaignState(sim)!;return{hf,sim,armies,units,state};
}
describe('Operation First Light',()=>{
 it('seeds a playable supplied base without Iron Dome and exactly two guarded launch cells',()=>{
   const {sim,armies,units,state}=fixture();
   const player=buildings(sim,1);expect(player.some(e=>e.building?.kind==='aa-tower')).toBe(false);expect(player.some(e=>e.building?.kind==='missile-defense')).toBe(false);
   for(const kind of ['command-yard','refinery','factory','helipad','barracks','wall','guard-tower'])expect(player.some(e=>e.building?.kind===kind)).toBe(true);
   expect(armies[0].economy.credits).toBe(6500);expect(armies[0].economy.powerProduced).toBeGreaterThan(armies[0].economy.powerUsed);
   expect(canBuildStructure(sim,armies[0].economy,'aa-tower').ok).toBe(true);
   expect(state.targetIds).toHaveLength(2);for(const team of [2,3]){expect(buildings(sim,team)).toHaveLength(1);expect(units.filter(e=>e.team?.id===team)).toHaveLength(4);}
 });
 it('stays peaceful before the trigger, then launches from both surviving cells at the player',()=>{
   const {sim,armies,state}=fixture();sim.tick=FIRST_STRIKE_TICK-1;stepFirstLight(sim,armies,state);expect(sim.projectiles).toHaveLength(0);
   sim.tick=FIRST_STRIKE_TICK;stepFirstLight(sim,armies,state);expect(state.phase).toBe('attack');expect(state.strikeCount).toBe(1);
   sim.tick+=90;stepFirstLight(sim,armies,state);expect(state.strikeCount).toBe(2);
   expect(new Set(sim.projectiles.map(p=>p.teamId))).toEqual(new Set([2,3]));
   expect(sim.events.filter(e=>e.kind==='strategic-missile-warning').every(e=>e.targetTeamId===1)).toBe(true);
 });
 it('wins when both launchers fall even if guards survive; HQ destruction defeats the mission',()=>{
   const a=fixture();for(const target of campaignTargetsAlive(a.sim,a.state))target.destroyed={remaining:5};stepFirstLight(a.sim,a.armies,a.state);expect(a.state.phase).toBe('victory');expect(a.units.some(e=>e.team?.id===2&&!e.destroyed)).toBe(true);
   const b=fixture();b.armies[0].base.destroyed={remaining:5};stepFirstLight(b.sim,b.armies,b.state);expect(b.state.phase).toBe('defeat');
 });
 it('persists mission phase, launch schedule and target IDs across saves without replaying a salvo',()=>{
   const {sim,hf,armies,state}=fixture();sim.tick=FIRST_STRIKE_TICK;stepFirstLight(sim,armies,state);
   const loaded=loadSerializedSim(hf,serializeSim(sim)),restored=campaignState(loaded)!;expect(restored).toEqual(state);expect(hashSim(loaded)).toBe(hashSim(sim));
   const before=loaded.projectiles.length;stepFirstLight(loaded,armies,restored);expect(loaded.projectiles.length).toBe(before);
 });
});
