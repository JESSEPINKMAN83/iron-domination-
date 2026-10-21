import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../sim/world';
import { strategicWarningAudience, StrategicReportHistory } from './strategicReports';
const warning = (source: number, target: number, id = 1): CombatEvent => ({ kind: 'strategic-missile-warning', sourceTeamId: source, targetTeamId: target, strategicId: id, fromX: 0, fromZ: 0, toX: 100, toZ: 100, damage: 0, killed: false });
describe('strategic notification audience', () => {
  it('reserves incoming alarms for this army, not allies, third parties or outgoing fire', () => {
    expect(strategicWarningAudience(warning(2,1),1)).toBe('incoming');
    expect(strategicWarningAudience(warning(2,3),1)).toBe('intel');
    expect(strategicWarningAudience(warning(1,3),1)).toBeUndefined();
    expect(strategicWarningAudience({...warning(2,1),targetTeamId:undefined},1)).toBeUndefined();
    expect(strategicWarningAudience({...warning(2,1),kind:'siegeMissile'},1)).toBeUndefined();
  });
  it('records timed third-party launches once, with drone salvo counts and bounded history', () => {
    const history = new StrategicReportHistory();
    history.record(warning(2,1),1,30);
    history.record(warning(2,3),1,60);
    history.record(warning(2,3),1,61);
    history.record({...warning(3,2,2),kind:'ember-drone-warning',targetLabel:'Incoming salvo ×5'},1,90);
    expect(history.total).toBe(2);
    expect(history.reports[1]).toMatchObject({tick:90,source:3,target:2,count:5});
    for(let id=3;id<150;id++) history.record(warning(2,3,id),1,id*30);
    expect(history.reports).toHaveLength(100);
    expect(history.total).toBe(149);
  });
});
