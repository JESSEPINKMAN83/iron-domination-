import type { Entity } from '../sim/components';
import { issueMoveOrder, type GameSim } from '../sim/world';
export function showObjectiveExercise(sim:GameSim,raiders:Entity[],localTeam:number):void {
  const panel=document.createElement('div');
  panel.style.cssText='position:fixed;top:100px;left:12px;width:210px;padding:12px;border:1px solid #395448;border-radius:6px;background:#0c1715ed;color:#dbe8df;font:12px/1.5 system-ui;z-index:16';
  const title=document.createElement('strong');title.textContent='CAPTURE FIELD EXERCISE';
  const text=document.createElement('p');text.textContent='Click a site at the top to locate it. Park tanks beside the structure, inside its ring, for 8 seconds. Aircraft cannot capture.';
  const button=document.createElement('button');button.textContent='Send enemy raiders';button.style.cssText='padding:7px;border:1px solid #b17a66;border-radius:4px;background:#32251f;color:#f0c7b6;cursor:pointer';
  button.onclick=()=>{
    const sites=[...sim.objectivesQuery];
    const site=sites.find(site=>site.objective.ownerTeam===localTeam)??sites[0];
    if(site){for(const unit of raiders)if(!unit.destroyed)unit.mover!.aggressive=true;issueMoveOrder(sim,raiders.filter(unit=>!unit.destroyed),site.transform.x,site.transform.z);}
    button.textContent='Raiders dispatched';
  };
  const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Close exercise help');close.style.cssText='float:right;background:none;border:0;color:#b7c7be;cursor:pointer';close.onclick=()=>panel.remove();
  panel.append(close,title,text,button);panel.addEventListener('pointerdown',event=>event.stopPropagation());document.body.append(panel);
}
