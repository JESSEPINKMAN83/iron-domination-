import { describe, expect, it } from 'vitest';
import type { Entity } from '../sim/components';
import { strategicScoutTargetTeam } from './commander';
const base = (team: number, x: number) => ({id:team,team:{id:team},building:{kind:'command-yard'},transform:{x,z:0}} as Entity);
describe('blind strategic target ownership', () => {
  it('labels each deployment sector with its actual army rather than the first hostile', () => {
    expect(strategicScoutTargetTeam({x:200,z:0,team:3},[1,3],[base(1,-200),base(3,200)])).toBe(3);
    expect(strategicScoutTargetTeam({x:200,z:0},[1,3],[base(1,-200),base(3,200)])).toBe(3);
    expect(strategicScoutTargetTeam({x:200,z:0,team:2},[1,3],[base(3,200)])).toBeUndefined();
  });
  it('does not assume the player is attacked for an unowned sector', () => {
    expect(strategicScoutTargetTeam({x:200,z:0},[1,3],[])).toBeUndefined();
    expect(strategicScoutTargetTeam({x:200,z:0},[3],[])).toBe(3);
  });
});
