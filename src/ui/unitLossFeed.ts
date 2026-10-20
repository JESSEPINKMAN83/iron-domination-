import type { GameSim } from '../sim/world';
import { UnitLossTracker } from './unitLossTracker';
import './unitLossFeed.css';

const listUnits = (units: Map<string, number>): string => [...units].map(([name, count]) => `${name} ×${count}`).join(' · ');
const clock = (tick: number): string => `${Math.floor(tick / 1800)}:${String(Math.floor(tick / 30) % 60).padStart(2, '0')}`;

export class UnitLossFeed {
  private readonly tracker: UnitLossTracker;
  private readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly panel = document.createElement('section');
  private readonly live = document.createElement('span');
  private readonly count = document.createElement('strong');
  private readonly detail = document.createElement('span');
  private seenTotal = 0;
  private visibleReports = 50;
  private quietTimer?: number;

  constructor(sim: GameSim, team: number, parent: HTMLElement) {
    this.tracker = new UnitLossTracker(sim, team);
    this.root.className = 'unit-loss-feed';
    this.button.type = 'button';
    this.button.className = 'unit-loss-feed__trigger';
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', 'unit-loss-history');
    this.button.setAttribute('aria-label', 'Unit losses: 0. Open loss history');
    this.count.textContent = 'Losses 0';
    this.detail.className = 'unit-loss-feed__detail';
    this.button.append(this.count, this.detail);
    this.panel.id = 'unit-loss-history';
    this.panel.className = 'unit-loss-feed__history';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Unit loss history');
    this.live.className = 'unit-loss-feed__sr';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    this.root.append(this.button, this.panel, this.live);
    parent.append(this.root);
    this.button.onclick = () => this.toggle();
    this.root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.panel.hidden) { event.stopPropagation(); this.toggle(false); this.button.focus(); }
    });
    for (const name of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel']) this.root.addEventListener(name, event => event.stopPropagation());
    parent.addEventListener('pointerdown', event => { if (!this.root.contains(event.target as Node)) this.toggle(false); });
  }

  update(): void {
    this.tracker.update();
    if (this.seenTotal === this.tracker.total) return;
    this.seenTotal = this.tracker.total;
    const latest = this.tracker.reports[this.tracker.reports.length - 1];
    this.root.classList.add('has-recent-loss');
    this.count.textContent = `−${latest.count} ${latest.count === 1 ? 'unit' : 'units'}`;
    this.detail.textContent = listUnits(latest.units);
    this.button.title = `${this.detail.textContent} · ${this.tracker.total} units lost this match. Click for history.`;
    const announcement = `${latest.count} ${latest.count === 1 ? 'unit' : 'units'} lost: ${this.detail.textContent}`;
    this.button.setAttribute('aria-label', `${announcement}. ${this.tracker.total} total. Open loss history`);
    this.live.textContent = announcement;
    if (this.quietTimer !== undefined) window.clearTimeout(this.quietTimer);
    this.quietTimer = window.setTimeout(() => {
      this.root.classList.remove('has-recent-loss');
      this.count.textContent = `Losses ${this.tracker.total}`;
      this.detail.textContent = '';
      this.button.setAttribute('aria-label', `Unit losses: ${this.tracker.total}. Open loss history`);
    }, 8000);
    if (!this.panel.hidden) this.renderHistory();
  }

  private toggle(open = this.panel.hidden): void {
    if (open) this.renderHistory();
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
  }

  private renderHistory(): void {
    const header = document.createElement('header');
    const title = document.createElement('strong'); title.textContent = `Unit losses · ${this.tracker.total}`;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close loss history'); close.onclick = () => { this.toggle(false); this.button.focus(); };
    header.append(title, close);
    const totals = document.createElement('p'); totals.className = 'unit-loss-feed__totals'; totals.textContent = this.tracker.total ? listUnits(this.tracker.totals) : 'No units lost this match.';
    const list = document.createElement('ol');
    for (const report of this.tracker.reports.slice(-this.visibleReports).reverse()) {
      const row = document.createElement('li');
      const time = document.createElement('time'); time.textContent = clock(report.tick);
      const text = document.createElement('span'); text.textContent = listUnits(report.units);
      row.append(time, text); list.append(row);
    }
    this.panel.replaceChildren(header, totals, list);
    if (this.tracker.reports.length > this.visibleReports) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'unit-loss-feed__more'; more.textContent = 'Show earlier losses'; more.onclick = () => { this.visibleReports += 50; this.renderHistory(); }; this.panel.append(more);
    }
  }
}

/** Explicitly labelled local test controls; never called by production. */
export function installUnitLossTest(sim: GameSim, team: number): void {
  const panel = document.createElement('div'); panel.className = 'unit-loss-test';
  const label = document.createElement('strong'); label.textContent = 'LOCAL LOSS FEED TEST'; panel.append(label);
  for (const [title, aircraft] of [['Destroy up to 2 friendly aircraft', true], ['Destroy up to 2 friendly ground units', false]] as const) {
    const button = document.createElement('button'); button.textContent = title;
    button.onclick = () => {
      const units = [...sim.selectables].filter(e => e.team?.id === team && !e.building && e.health && !e.destroyed && Boolean(e.flight) === aircraft).slice(0, 2);
      for (const entity of units) { entity.health!.current = 0; entity.destroyed = { remaining: 20 }; }
      if (!units.length) button.textContent = 'No matching units remain';
    };
    panel.append(button);
  }
  document.body.append(panel);
}
