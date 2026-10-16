import { describe, expect, it } from 'vitest';
import { debriefInsights } from './debriefInsights';
import type { ArmyDebriefStats } from './battleDebrief';
const army = (values: Partial<ArmyDebriefStats> = {}): ArmyDebriefStats => ({ team: 1, side: 1, label: 'Your army', isLocal: true, eliminated: false, credits: 0, income: 0, spent: 0, refunds: 0, unitsDeployed: 0, unitsSurviving: 0, unitLosses: 0, buildingsConstructed: 0, buildingsSurviving: 0, buildingLosses: 0, collectorsSurviving: 0, shotsFired: 0, hits: 0, damageDealt: 0, damageReceived: 0, unitKills: 0, buildingKills: 0, attacksLaunched: 0, rebuilds: 0, retreats: 0, ...values });
describe('battle findings', () => {
  it('compares personal outgoing and incoming damage, not combined enemy output', () => {
    const findings = debriefInsights(army({ damageDealt: 200, damageReceived: 100 }), [army({ label: 'Rival', damageDealt: 5000 })], 120);
    expect(findings.find(i => i.title === 'Your damage exchange')).toMatchObject({ tone: 'positive', text: expect.stringContaining('2.00×') });
    expect(findings.find(i => i.title.includes('enemy firepower'))?.text).toContain('not just yours');
  });
  it('handles empty and no incoming damage matches without fabricated conclusions', () => {
    expect(debriefInsights(army(), [], 0)).toEqual([expect.objectContaining({ title: 'A quiet battlefield' })]);
    expect(debriefInsights(army({ damageDealt: 100 }), [], 0)[0].text).toContain('No damage received');
  });
  it('normalizes economy by simulated time and qualifies unit trades', () => {
    const findings = debriefInsights(army({ unitKills: 2, unitLosses: 5, income: 1000, credits: 4000 }), [], 120);
    expect(findings[0]).toMatchObject({ tone: 'warning', text: expect.stringContaining('do not account for unit cost') });
    expect(findings.find(i => i.title.includes('economy'))?.text).toContain('$500 harvested per minute');
  });
});
