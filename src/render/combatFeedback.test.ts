import { describe,expect,it } from 'vitest';
import { combatFeedback } from './combatFeedback';
import type { CombatEvent } from '../sim/world';
const event=(kind:string,damage=0,extra:Partial<CombatEvent>={}):CombatEvent=>({kind,damage,killed:false,fromX:0,fromZ:0,toX:0,toZ:0,...extra});
describe('combat feedback',()=>{
  it('distinguishes armor, hits, kills, misses and interceptions',()=>{
    expect(combatFeedback(event('kineticShell-impact',30,{targetType:'tank'}))).toBe('armor');
    expect(combatFeedback(event('rifle',10))).toBe('hit');
    expect(combatFeedback(event('kineticShell-impact',30,{killed:true}))).toBe('destroyed');
    expect(combatFeedback(event('rifle'))).toBe('miss');
    expect(combatFeedback(event('strategic-missile-intercepted',0,{killed:true}))).toBe('intercept');
  });
  it('never calls projectile launches or bookkeeping misses',()=>{
    for(const kind of ['kineticShell','tankMissile','grenade','bomb','ore-delivery','impact-reaction','ember-drone-lock','strategic-missile-warning'])expect(combatFeedback(event(kind))).toBeUndefined();
  });
});
