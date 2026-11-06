import type { Entity } from '../sim/components';
export interface DeterrenceMemory { failures:number; tick:number; requiredHp:number }
export interface AssaultExperience { members:Entity[]; initialHp:number; dealt:Record<number,number>; received:Record<number,number>; reported:boolean }
const sum=(members:Entity[],kind:'dealt'|'received')=>{
  const totals:Record<number,number>={};
  for(const member of members)for(const [team,value] of Object.entries(member.battleRecord?.[kind]??{}))totals[+team]=(totals[+team]??0)+value;
  return totals;
};
export function beginAssault(members:Entity[]):AssaultExperience {
  return {members:[...members],initialHp:members.reduce((n,e)=>n+(e.health?.current??0),0),dealt:sum(members,'dealt'),received:sum(members,'received'),reported:false};
}
/** Only the attacker's own losses and confirmed damage count, including wiped-out units. */
export function failedAssault(battle:AssaultExperience):{team:number;lostHp:number}|undefined {
  if(battle.reported||battle.initialHp<=0)return;
  const remaining=battle.members.reduce((n,e)=>n+(e.destroyed?0:e.health?.current??0),0),lost=battle.initialHp-remaining;
  if(lost<battle.initialHp*.6)return;
  const received=sum(battle.members,'received'),dealt=sum(battle.members,'dealt');
  const dominant=Object.keys(received).map(Number).sort((a,b)=>(received[b]-(battle.received[b]??0))-(received[a]-(battle.received[a]??0))||a-b)[0];
  if(dominant===undefined || received[dominant]-(battle.received[dominant]??0)<lost*.5 || (dealt[dominant]??0)-(battle.dealt[dominant]??0)>lost*.35)return;
  return {team:dominant,lostHp:lost};
}
export function deterrencePressure(memory:DeterrenceMemory|undefined,tick:number):number {
  if(!memory)return 0;
  return Math.min(3,memory.failures)*Math.max(0,1-Math.max(0,tick-memory.tick)/(30*480));
}
export function opponentPenalty(memory:DeterrenceMemory|undefined,tick:number,forceHp:number):number {
  const pressure=deterrencePressure(memory,tick);
  if(!memory || !pressure)return 0;
  const prepared=forceHp>=memory.requiredHp && tick-memory.tick>=30*90;
  return pressure*(prepared?160:1800);
}

export function addAssaultMembers(battle:AssaultExperience,members:Entity[]):void {
  const added=beginAssault(members.filter(member=>!battle.members.includes(member)));
  battle.members.push(...added.members);battle.initialHp+=added.initialHp;
  for(const kind of ['dealt','received'] as const)for(const [team,value] of Object.entries(added[kind]))battle[kind][+team]=(battle[kind][+team]??0)+value;
}
