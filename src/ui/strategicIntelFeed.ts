import type { CombatEvent } from '../sim/world';
import { StrategicReportHistory } from './strategicReports';
import './strategicIntelFeed.css';

export class StrategicIntelFeed {
  private readonly history = new StrategicReportHistory();
  private readonly root = document.createElement('div');
  private readonly trigger = document.createElement('button');
  private readonly panel = document.createElement('section');
  private timer?: number;
  constructor(private readonly localTeam: number, private readonly armyLabel: (team: number) => string, parent: HTMLElement) {
    this.root.className = 'strategic-intel'; this.root.hidden = true;
    this.trigger.type = 'button'; this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', 'strategic-intel-history');
    this.trigger.title = 'Other armies’ strategic launches. Click for intelligence history.';
    this.panel.id = 'strategic-intel-history'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Battlefield intelligence history');
    this.trigger.onclick = () => this.toggle(this.panel.hidden);
    this.root.append(this.trigger, this.panel); parent.append(this.root);
    for (const name of ['pointerdown','pointerup','click','dblclick','wheel']) this.root.addEventListener(name, e => e.stopPropagation());
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape' && !this.panel.hidden) { e.stopPropagation(); this.toggle(false); this.trigger.focus(); } });
    parent.addEventListener('pointerdown', e => { if (!this.root.contains(e.target as Node)) this.toggle(false); });
  }
  record(event: CombatEvent, tick: number): void {
    const report = this.history.record(event, this.localTeam, tick);
    if (!report) return;
    this.root.hidden = false;
    this.trigger.textContent = `Intel · ${this.armyLabel(report.source)} → ${this.armyLabel(report.target)}`;
    this.trigger.setAttribute('aria-label', `${this.trigger.textContent}. Open launch history`);
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.trigger.textContent = `Intel ${this.history.total} ▾`; this.trigger.setAttribute('aria-label', `Battlefield intelligence: ${this.history.total} launches. Open history`); }, 8000);
    if (!this.panel.hidden) this.render();
  }
  private toggle(open: boolean): void {
    this.panel.hidden = !open; this.trigger.setAttribute('aria-expanded', String(open));
    if (open) this.render();
  }
  private render(): void {
    const header = document.createElement('header');
    const title = document.createElement('strong'); title.textContent = 'Battlefield intelligence';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label','Close intelligence history');
    close.onclick = () => { this.toggle(false); this.trigger.focus(); }; header.append(title,close);
    const list = document.createElement('ol');
    for (const report of [...this.history.reports].reverse()) {
      const row = document.createElement('li'), time = document.createElement('time'), text = document.createElement('span');
      time.textContent = `${Math.floor(report.tick / 1800)}:${String(Math.floor(report.tick / 30) % 60).padStart(2,'0')}`;
      text.textContent = `${this.armyLabel(report.source)} → ${this.armyLabel(report.target)} · ${report.threat}${report.count > 1 ? ` ×${report.count}` : ''}`;
      row.append(time,text); list.append(row);
    }
    this.panel.replaceChildren(header,list);
  }
}
