import type { Entity } from './components';
import { spawnInfantryAt } from './economy';
import { sampleHeight, type Heightfield } from './heightfield';
import { spawnTankAt, type GameSim } from './world';

export interface TerrainTrial { label:string; description:string; point:{x:number;z:number}; units:Entity[] }

/** Uses real generated features rather than granting preview-only terrain bonuses. */
export function stageTerrainPreview(sim:GameSim,hf:Heightfield,team:number,enemyTeam:number):TerrainTrial[] {
  const features=hf.terrainAdvantages!;
  const candidates=Array.from(hf.walkable.keys()).filter(i=>hf.walkable[i] && Math.abs((i%hf.cells+.5)*hf.cellSize-hf.size/2)<hf.size*.34 && Math.abs((Math.floor(i/hf.cells)+.5)*hf.cellSize-hf.size/2)<hf.size*.34);
  const point=(i:number)=>({x:(i%hf.cells+.5)*hf.cellSize-hf.size/2,z:(Math.floor(i/hf.cells)+.5)*hf.cellSize-hf.size/2});
  const road=candidates.filter(i=>features.roads[i]).sort((a,b)=>{const p=point(a),q=point(b);return Math.hypot(p.x,p.z)-Math.hypot(q.x,q.z);})[0];
  const forest=candidates.filter(i=>features.woodland[i] && [-1,0,1].every(dz=>[-1,0,1].every(dx=>features.woodland[i+dz*hf.cells+dx]))).sort((a,b)=>{const p=point(a),q=point(b);return Math.hypot(p.x,p.z)-Math.hypot(q.x,q.z);})[0];
  const ridge=candidates.slice().sort((a,b)=>features.sight[b]-features.sight[a])[0];
  const trials:TerrainTrial[]=[];
  const prepare=(unit:Entity)=>{unit.transform.y=sampleHeight(hf,unit.transform.x,unit.transform.z);unit.previousTransform={...unit.transform};return unit;};
  if(road!==undefined){const p=point(road);const tank=prepare(spawnTankAt(sim,p.x,p.z,'Road test tank',team));
    trials.push({label:'Road',description:'This tank starts on a dirt route. Move along it: ground units gain 20% speed. Leaving the road returns to normal speed.',point:p,units:[tank]});}
  if(forest!==undefined){const p=point(forest);const squad=prepare(spawnInfantryAt(sim,p.x,p.z,team,'infantry'));
    // An unarmed spotter demonstrates that nearby enemy infantry remains concealed until approached.
    const spot=sim.nav.nearestWalkableCellGlobal(p.x+85,p.z);const q=spot?sim.nav.cellCenter(spot.x,spot.y):{x:p.x+85,z:p.z};
    const enemy=prepare(spawnTankAt(sim,q.x,q.z,'Enemy woodland observer',enemyTeam));enemy.weapon=undefined;enemy.weapons=undefined;enemy.vision!.radius=110;
    trials.push({label:'Woodland',description:'Your infantry starts concealed in a darker grove. Move out to lose concealment, or fire to expose it for 6 seconds. A nearby enemy observer can detect it only when close enough.',point:p,units:[squad,enemy]});}
  if(ridge!==undefined){const p=point(ridge),unit=prepare(spawnInfantryAt(sim,p.x,p.z,team,'sniper'));
    trials.push({label:'High ground',description:'Select the scout on this ridge. Its status shows the sight bonus, capped at 25%. Move downhill to compare; weapon range stays unchanged.',point:p,units:[unit]});}
  return trials;
}
