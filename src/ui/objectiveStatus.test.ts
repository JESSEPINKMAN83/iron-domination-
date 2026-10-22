import { describe,expect,it } from 'vitest';
import { applyArmyNations } from '../content/nations';
import { objectiveStatus } from './objectiveStatus';
const neutral={kind:'radar' as const,captureTicks:0,contested:false,rewardTicks:0};
describe('objective ownership presentation',()=>{
  it('has a white flag for unowned sites and identifies each capturing country',()=>{
    applyArmyNations(['iron-legion','missile-command']);
    expect(objectiveStatus(neutral,true,1).flagTeam).toBeUndefined();
    const capture=objectiveStatus({...neutral,capturingTeam:2,captureTicks:120},true,1);
    expect(capture.label).toContain('Iran capturing 50%');expect(capture.flagTeam).toBe(2);
    const owned=objectiveStatus({...neutral,ownerTeam:1},true,1);
    expect(owned.label).toContain('Israel (you)');expect(owned.description).toContain('Owner: Israel');
  });
  it('does not claim a contested site for the stale capturer or expose hidden capture attempts',()=>{
    expect(objectiveStatus({...neutral,capturingTeam:2,contested:true},true,1).flagTeam).toBeUndefined();
    expect(objectiveStatus({...neutral,capturingTeam:2,ownerTeam:1,contested:true},true,1).flagTeam).toBe(1);
    const hidden=objectiveStatus({...neutral,capturingTeam:2,captureTicks:90},false,1);
    expect(hidden.label).toContain('Neutral');expect(hidden.label).not.toContain('capturing');expect(hidden.flagTeam).toBeUndefined();
  });
});
