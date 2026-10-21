import type { CombatEvent } from '../sim/world';

export function strategicWarningAudience(event: CombatEvent, localTeam: number): 'incoming' | 'intel' | undefined {
  if (event.kind !== 'strategic-missile-warning' && event.kind !== 'ember-drone-warning') return undefined;
  if (event.targetTeamId === undefined || event.sourceTeamId === undefined || event.sourceTeamId === event.targetTeamId) return undefined;
  if (event.targetTeamId === localTeam && event.sourceTeamId !== localTeam) return 'incoming';
  if (event.sourceTeamId !== localTeam && event.targetTeamId !== localTeam) return 'intel';
  return undefined;
}

export interface StrategicReport { tick: number; source: number; target: number; threat: string; count: number; id?: number }
export class StrategicReportHistory {
  readonly reports: StrategicReport[] = [];
  total = 0;
  record(event: CombatEvent, localTeam: number, tick: number): StrategicReport | undefined {
    if (strategicWarningAudience(event, localTeam) !== 'intel') return;
    if (event.strategicId !== undefined && this.reports.some(report => report.id === event.strategicId)) return;
    const report = { tick, source: event.sourceTeamId!, target: event.targetTeamId!,
      threat: event.kind === 'ember-drone-warning' ? 'Shahed drones' : 'Fattah missile',
      count: event.kind === 'ember-drone-warning' ? Number(/×(\d+)/.exec(event.targetLabel ?? '')?.[1] ?? 1) : 1,
      id: event.strategicId };
    this.reports.push(report);
    if (this.reports.length > 100) this.reports.shift();
    this.total++;
    return report;
  }
}
