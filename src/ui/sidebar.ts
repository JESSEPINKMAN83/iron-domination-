import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import { buildings, canBuildStructure, canQueueUnit, type EconomyState } from '../sim/economy';
import type { GameSim } from '../sim/world';

type Tab = 'structures' | 'infantry' | 'vehicles';

export interface SidebarActions {
  buildStructure(kind: StructureKind): void;
  queueUnit(kind: UnitKind): void;
}

export class Sidebar {
  private readonly root: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private activeTab: Tab = 'structures';
  private lastStatusText = '';
  private lastBodyKey = '';

  constructor(private readonly sim: GameSim, private readonly economy: EconomyState, private readonly actions: SidebarActions) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:12px;right:12px;width:280px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;gap:8px;' +
      'font:12px/1.35 ui-monospace,Menlo,monospace;color:#d7e0e7;background:rgba(9,13,16,.82);border:1px solid rgba(255,255,255,.1);' +
      'border-radius:6px;padding:10px;z-index:12;box-shadow:0 10px 28px rgba(0,0,0,.28);';
    this.status = document.createElement('div');
    this.tabs = document.createElement('div');
    this.tabs.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;';
    this.body = document.createElement('div');
    this.body.style.cssText = 'display:flex;flex-direction:column;gap:6px;overflow:auto;';
    this.root.append(this.status, this.tabs, this.body);
    document.body.appendChild(this.root);
    this.renderTabs();
  }

  update(): void {
    const statusText = [
      `credits ${Math.floor(this.economy.credits)}`,
      `power ${this.economy.powerProduced - this.economy.powerUsed >= 0 ? '+' : ''}${this.economy.powerProduced - this.economy.powerUsed} (${this.economy.powerProduced}/${this.economy.powerUsed})`,
      `ledger ${this.economy.ledger.slice(-1)[0]?.label ?? 'ready'}`,
    ].join('\n');
    if (statusText !== this.lastStatusText) {
      this.status.textContent = statusText;
      this.lastStatusText = statusText;
    }
    const bodyKey = this.bodyKey();
    if (bodyKey !== this.lastBodyKey) {
      this.lastBodyKey = bodyKey;
      this.renderBody();
    }
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const tab of ['structures', 'infantry', 'vehicles'] as const) {
      const button = document.createElement('button');
      button.textContent = tab.toUpperCase();
      button.style.cssText = buttonCss(tab === this.activeTab);
      button.onclick = () => {
        this.activeTab = tab;
        this.lastBodyKey = '';
        this.renderTabs();
        this.renderBody();
      };
      this.tabs.appendChild(button);
    }
  }

  private renderBody(): void {
    this.body.replaceChildren();
    if (this.activeTab === 'structures') {
      for (const def of Object.values(STRUCTURES)) {
        const check = canBuildStructure(this.sim, this.economy, def.kind);
        this.body.appendChild(this.card(def.label, def.cost, check.ok, check.reason, () => this.actions.buildStructure(def.kind)));
      }
    } else {
      for (const def of Object.values(UNITS).filter((unit) => unit.tab === this.activeTab)) {
        const check = canQueueUnit(this.sim, this.economy, def.kind);
        this.body.appendChild(this.card(def.label, def.cost, check.ok, check.reason, () => this.actions.queueUnit(def.kind)));
      }
      for (const producer of buildings(this.sim).filter((entity) => entity.producer && entity.building?.complete)) {
        const line = document.createElement('div');
        const active = producer.producer?.active;
        line.style.cssText = 'padding:6px;border-top:1px solid rgba(255,255,255,.08);color:#aebbc4;';
        line.textContent = `${producer.building?.label}: ${active ? `${active.label} ${Math.round((1 - active.remaining / active.total) * 100)}%` : 'idle'} q${producer.producer?.queue.length ?? 0}`;
        this.body.appendChild(line);
      }
    }
  }

  private card(label: string, cost: number, enabled: boolean, reason: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.disabled = !enabled;
    button.title = reason;
    button.textContent = enabled ? `${label}  $${cost}` : `${label}  ${reason}`;
    button.style.cssText =
      'min-height:38px;text-align:left;padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,.12);' +
      `background:${enabled ? 'rgba(44,67,72,.92)' : 'rgba(40,42,44,.72)'};color:${enabled ? '#e9f1f5' : '#87919a'};cursor:${enabled ? 'pointer' : 'not-allowed'};`;
    button.onclick = action;
    return button;
  }

  private bodyKey(): string {
    const completedBuildings = buildings(this.sim)
      .filter((entity) => entity.building?.complete)
      .map((entity) => `${entity.id}:${entity.building?.kind}`)
      .join('|');
    const producers = buildings(this.sim)
      .filter((entity) => entity.producer && entity.building?.complete)
      .map((entity) => {
        const active = entity.producer?.active;
        const pct = active ? Math.round((1 - active.remaining / active.total) * 100) : 0;
        return `${entity.id}:${active?.kind ?? 'idle'}:${pct}:${entity.producer?.queue.length ?? 0}`;
      })
      .join('|');
    return [
      this.activeTab,
      Math.floor(this.economy.credits),
      this.economy.powerProduced,
      this.economy.powerUsed,
      this.economy.selectedStructure ?? '',
      completedBuildings,
      producers,
    ].join('~');
  }
}

function buttonCss(active: boolean): string {
  return (
    'height:30px;border-radius:4px;border:1px solid rgba(255,255,255,.12);font:10px ui-monospace,Menlo,monospace;' +
    `background:${active ? '#d2b15f' : 'rgba(255,255,255,.06)'};color:${active ? '#141614' : '#d7e0e7'};cursor:pointer;`
  );
}
