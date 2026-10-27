import type { Entity } from './components';

export interface ArmorImpact {
  fromX:number;
  fromY?:number;
  fromZ:number;
  splashRadius:number;
  trajectory?:'flat'|'homing'|'arc'|'drop';
}

/** Hull facing, never turret aim. Only direct, shallow-angle vehicle hits flank armor. */
export function directionalArmorMultiplier(target:Entity,impact:ArmorImpact):number {
  if(target.flight || target.building || !target.mover || (target.armor?.kind!=='heavy' && target.armor?.kind!=='light')) return 1;
  if(impact.splashRadius>0 || impact.trajectory==='arc' || impact.trajectory==='drop') return 1;
  const dx=impact.fromX-target.transform.x,dz=impact.fromZ-target.transform.z;
  const distance=Math.hypot(dx,dz);
  if(distance<0.01) return 1;
  if(impact.fromY!==undefined && target.transform.y!==undefined && impact.fromY-target.transform.y>distance*0.7) return 1;
  const forward=dx*Math.sin(target.transform.rot)+dz*Math.cos(target.transform.rot);
  const side=dx*Math.cos(target.transform.rot)-dz*Math.sin(target.transform.rot);
  if(Math.abs(side)>Math.abs(forward)) return 1.25;
  return forward<0?1.5:1;
}
