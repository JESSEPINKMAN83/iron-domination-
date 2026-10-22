import { WEAPONS, type WeaponKind } from '../content/phase4';
import type { CombatEvent } from '../sim/world';
export type CombatFeedback = 'armor' | 'hit' | 'intercept' | 'miss' | 'destroyed';
export const FEEDBACK_COLORS: Record<CombatFeedback,string> = { armor:'#ffd17a',hit:'#9de5c4',intercept:'#73e6ff',miss:'#a5aaa7',destroyed:'#ff6a54' };
/** Launch events carry zero damage too: only terminal weapon events can be misses. */
export function combatFeedback(event: CombatEvent): CombatFeedback | undefined {
  if(event.kind==='strategic-missile-intercepted')return 'intercept';
  const weapon=WEAPONS[event.kind as WeaponKind];
  const terminal=event.kind.endsWith('-impact') || (!!weapon && !weapon.projectile && !['bomb','tankBomb','strategicMissile','emberDrone'].includes(event.kind)) || event.kind==='crash';
  if(!terminal)return undefined;
  if(event.killed)return 'destroyed';
  if(event.damage>0)return event.targetType==='tank'?'armor':'hit';
  return 'miss';
}
