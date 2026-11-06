import type { Entity } from '../sim/components';
import type { Heightfield } from '../sim/heightfield';
import { spawnScoutTankAt, spawnSiegeTankAt, spawnWaspAt, spawnHammerheadAt, type GameSim } from '../sim/world';
import type { UnitKind } from './phase3';
import { UNIT_ARSENALS, type UnitArsenal } from './unitArsenal';
import { WEAPONS } from './phase4';

export const USA_SPECIALISTS = ['bradley','mlrs','strike-jet','bomber'] as const;
export function isUSSpecialist(kind: UnitKind): boolean { return (USA_SPECIALISTS as readonly string[]).includes(kind); }
export function usaArsenal(kind: UnitKind): UnitArsenal {
  const names: Partial<Record<UnitKind,string>> = { infantry:'US RIFLE SQUAD',sniper:'US SCOUT SNIPER',grenadier:'US ASSAULT SQUAD','rocket-infantry':'JAVELIN TEAM','scout-tank':'STRYKER DRAGOON',tank:'M1A2 ABRAMS','siege-tank':'M109 PALADIN',artillery:'M777 FIELD ARTILLERY',wasp:'AH-1Z VIPER',vulture:'AH-64 APACHE',hammerhead:'MQ-9 REAPER' };
  return { ...UNIT_ARSENALS[kind], ...(kind==='hammerhead'?{primary:'precisionMissile' as const,secondary:'bomb' as const,secondarySalvoCount:2}:{}), designation:names[kind] ?? UNIT_ARSENALS[kind].designation };
}
export function applyUSAProfile(entity: Entity, kind: UnitKind): void {
  if (entity.usaProfile) return;
  entity.usaProfile=true;entity.rosterKind=kind;
  if (!isUSSpecialist(kind) && kind!=='hammerhead') return;
  const stats = kind === 'hammerhead' ? {hp:145,speed:38,radius:3.2,vision:195} : kind === 'bradley' ? {hp:130,speed:20,radius:2.4,vision:160}
    : kind === 'mlrs' ? {hp:135,speed:12,radius:3.2,vision:210}
    : kind === 'strike-jet' ? {hp:160,speed:82,radius:3.7,vision:190}
    : {hp:210,speed:42,radius:10,vision:180};
  entity.health={current:stats.hp,max:stats.hp};
  if(entity.mover){entity.mover.speed=stats.speed;entity.mover.radius=stats.radius;}
  if(entity.selectable) entity.selectable.radius=stats.radius+.3;
  entity.collider={radius:stats.radius};entity.vision={radius:stats.vision};
  const arsenal=usaArsenal(kind);
  const primary={kind:arsenal.primary,range:WEAPONS[arsenal.primary].range,cooldown:0,salvoCount:kind==='bomber'?2:undefined};
  entity.weapon=primary;entity.weapons={primary,secondary:arsenal.secondary?{kind:arsenal.secondary,range:WEAPONS[arsenal.secondary].range,cooldown:0,salvoCount:arsenal.secondarySalvoCount}:undefined};
  if(entity.flight){
    entity.flight.model=kind==='bomber'?'bomber':kind==='hammerhead'?'drone':'jet';entity.flight.agility=kind==='bomber'?.55:1;
    entity.flight.cruiseAltitude=kind==='bomber'?52:38;entity.flight.maxAltitude=140;
  }
  if(kind==='bradley')entity.armor={kind:'light'};
}
export function spawnUSSpecialist(sim:GameSim,hf:Heightfield,x:number,z:number,team:number,kind:UnitKind):Entity {
  const entity = kind==='bradley'?spawnScoutTankAt(sim,x,z,'M2 Bradley',team)
    :kind==='mlrs'?spawnSiegeTankAt(sim,x,z,'M270 MLRS',team)
    :kind==='strike-jet'?spawnWaspAt(sim,hf,x,z,'F-15E',team)
    :spawnHammerheadAt(sim,hf,x,z,'B-2',team);
  applyUSAProfile(entity,kind);return entity;
}
