import type { Entity } from '../sim/components';
import { STRUCTURES, type StructureKind } from '../content/phase3';
import { buildings, placeStructure, recomputePower, spawnInfantryAt, updatePlacement, type EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import { launchStrategicMissileAt } from '../sim/strategicWarfare';
import { spawnTankAt, spawnWaspAt, type GameSim } from '../sim/world';

export const FIRST_LIGHT_ID = 'first-light' as const;
export const FIRST_STRIKE_TICK = 24 * 30;
export interface CampaignState {
  mission: typeof FIRST_LIGHT_ID;
  phase: 'quiet' | 'attack' | 'victory' | 'defeat';
  targetIds: number[];
  nextStrikeTicks: number[];
  strikeCount: number;
}
export interface CampaignArmy { team:number; economy:EconomyState; base:Entity }
export const CAMPAIGN_BRIEFING_TEXT = 'This is Lieutenant Yael, your liaison at Northern Command. We’ve detected missiles incoming from two Iranian launch sites. Our base has defenses, but no Iron Dome coverage. Your first priority is to build and power an Iron Dome battery. Then scout the marked areas, assemble your strike force, and destroy both launchers. Keep Command HQ standing. Find those launchers and take them out.';
export const CAMPAIGN_BRIEFING_AUDIO = '/assets/audio/campaign/first-light-briefing.mp3';
export const CAMPAIGN_SHIELD_AUDIO = '/assets/audio/campaign/first-light-shield-online.mp3';
export const CAMPAIGN_SCRIPT = {
  quiet: { title:'Mission briefing', text:CAMPAIGN_BRIEFING_TEXT },
  attack: { title:'Code Red · two launch cells', text:CAMPAIGN_BRIEFING_TEXT },
  shield: { title:'Iron Dome online', text:"Yael here. Iron Dome is online, but it won’t stop every missile. Keep your defenses powered while we prepare a strike. Check your credits and make sure your ore collector is working. If income is slow, strengthen your economy before spending everything on aircraft. Build a small strike force, then scout the two marked areas. Each launcher has guards—use your aircraft to spot them and plan your approach. Destroy both missile launchers to end the attacks. Protect the base, but keep moving toward the objective." },
  victory: { title:'The sky is clear', text:"Both launchers are destroyed. No further launches are detected. Command HQ is secure. Well done, Commander. The base is safe. Operation First Light is complete." },
} as const;

/** Authored assets use the same placement, production and collision rules as skirmish. */
export function seedFirstLight(sim:GameSim,hf:Heightfield,armies:CampaignArmy[]):Entity[] {
  const player=armies.find(a=>a.team===1);if(!player)throw new Error('Campaign requires Israel in army 1');
  const units:Entity[]=[];
  const place=(army:CampaignArmy,kind:StructureKind,wantedX:number,wantedZ:number):Entity=>{
    const def=STRUCTURES[kind];
    for(let ring=0;ring<=8;ring++)for(let iz=-ring;iz<=ring;iz++)for(let ix=-ring;ix<=ring;ix++) {
      if(ring && Math.max(Math.abs(ix),Math.abs(iz))!==ring)continue;
      const p=updatePlacement(sim,hf,kind,wantedX+ix*12,wantedZ+iz*12,army.team);
      if(!p.valid)continue;
      if(def.tab==='defense')army.economy.readyDefenseStructure=kind;else army.economy.readyStructure=kind;
      const entity=placeStructure(sim,hf,army.economy,p);
      if(entity?.building){entity.building.buildProgress=1;return entity;}
    }
    throw new Error(`Campaign placement unavailable: ${kind}`);
  };
  const base=player.base.transform;
  const structures:Array<[StructureKind,number,number]>=[['power-plant',-42,-12],['power-plant',-42,35],['power-plant',5,-44],['refinery',43,-15],['barracks',-42,80],['factory',46,38],['helipad',45,90],['guard-tower',-80,-48],['guard-tower',80,-48],['skylance-ciws',88,80]];
  for(const [kind,x,z] of structures)place(player,kind,base.x+x,base.z+z);
  // Two short perimeter sections leave a wide route out for tanks and collectors.
  sim.nav.batchBlockers(()=>{for(const side of [-1,1])for(let i=0;i<5;i++)place(player,'wall',base.x+side*(30+i*12),base.z-78);});
  for(let i=0;i<3;i++)units.push(spawnTankAt(sim,base.x-12+i*12,base.z+50,`Ready armor ${i+1}`,1));
  for(let i=0;i<4;i++)units.push(spawnInfantryAt(sim,base.x-24+i*8,base.z+32,1,i===3?'rocket-infantry':'infantry'));
  units.push(spawnWaspAt(sim,hf,base.x+80,base.z+120,'Recon helicopter',1));
  player.economy.credits=6500;
  player.economy.ledger=[];
  const targets:Entity[]=[];
  for(const army of armies.filter(a=>a.team!==1)) {
    const pos={...army.base.transform};
    // No hostile HQ, production base or general-purpose commander in this mission.
    const silo=place(army,'strategic-silo',pos.x+45,pos.z);
    for(const entity of [...sim.world.entities])if(entity.team?.id===army.team&&entity!==silo){sim.nav.removeDynamicBlocker(entity.id);sim.world.remove(entity);}
    silo.name=army.team===2?'Launch cell Alpha':'Launch cell Bravo';silo.building!.label=silo.name;
    // A self-contained field generator powers the launcher without an enemy base.
    silo.building!.powerProduced=60;
    army.base=silo;army.economy.credits=15000;
    targets.push(silo);
    for(let i=0;i<4;i++) {
      const cell=sim.nav.nearestWalkableCellGlobal(silo.transform.x+(i%2?30:-30),silo.transform.z+(i<2?-30:30));
      if(!cell)continue;const p=sim.nav.cellCenter(cell.x,cell.y);
      const guard=i<2?spawnInfantryAt(sim,p.x,p.z,army.team,i===1?'rocket-infantry':'infantry'):spawnTankAt(sim,p.x,p.z,`Cell guard ${i+1}`,army.team);
      if(i===3){guard.name='Mobile air defense';guard.weapon={kind:'aaMissile',range:115,cooldown:0};guard.weapons=undefined;}
      guard.mover!.holdPosition={x:p.x,z:p.z};units.push(guard);
    }
  }
  for(const army of armies)recomputePower(sim,army.economy);
  player.base.campaign={mission:FIRST_LIGHT_ID,phase:'quiet',targetIds:targets.map(t=>t.id),nextStrikeTicks:targets.map((_,i)=>sim.tick+FIRST_STRIKE_TICK+i*90),strikeCount:0};
  return units;
}

export function campaignState(sim:GameSim):CampaignState|undefined {
  for(const entity of sim.world.entities)if(entity.campaign?.mission===FIRST_LIGHT_ID)return entity.campaign;
  return undefined;
}
export function campaignTargetsAlive(sim:GameSim,state:CampaignState):Entity[] {
  return state.targetIds.map(id=>sim.byId.get(id)).filter((e):e is Entity=>!!e&&!e.destroyed&&(e.health?.current??0)>0);
}
export function campaignShieldOnline(sim:GameSim,economy:EconomyState):boolean {
  return economy.powerProduced>=economy.powerUsed&&buildings(sim,1).some(e=>!e.destroyed&&e.building?.kind==='aa-tower'&&e.building.complete&&e.building.buildProgress>=1);
}

/** Tick-based and saved on HQ: no wall-clock launch timers or repeated opening strikes after loading. */
export function stepFirstLight(sim:GameSim,armies:CampaignArmy[],state:CampaignState):void {
  if(state.phase==='victory'||state.phase==='defeat')return;
  const hq=buildings(sim,1).find(e=>e.building?.kind==='command-yard'&&!e.destroyed&&(e.health?.current??0)>0);
  if(!hq){state.phase='defeat';return;}
  if(!campaignTargetsAlive(sim,state).length){state.phase='victory';return;}
  for(let index=0;index<state.targetIds.length;index++) {
    const target=sim.byId.get(state.targetIds[index]);
    if(!target||target.destroyed||sim.tick<state.nextStrikeTicks[index])continue;
    const attacker=armies.find(a=>a.team===target.team?.id);if(!attacker)continue;
    // First salvo tests the perimeter; later missiles pressure the inner base.
    const offset=state.strikeCount<2?65:28;
    const result=launchStrategicMissileAt(sim,attacker.economy,1,hq.transform.x+(index?offset:-offset),hq.transform.z-20);
    if(result.ok){state.strikeCount++;state.phase='attack';state.nextStrikeTicks[index]=sim.tick+65*30;}
    else state.nextStrikeTicks[index]=sim.tick+30;
  }
}
