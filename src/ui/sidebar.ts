import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity } from '../sim/components';
import { buildings, canBuildStructure, canQueueUnit, type EconomyState } from '../sim/economy';
import { selectedEntities, type GameSim } from '../sim/world';

type Tab = 'structures' | 'infantry' | 'vehicles';

export interface SidebarActions {
  buildStructure(kind: StructureKind): void;
  queueUnit(kind: UnitKind, producer?: Entity): void;
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
      'position:fixed;top:12px;right:12px;width:318px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;gap:8px;' +
      'font:12px/1.35 ui-monospace,Menlo,monospace;color:#e0e7dd;background:linear-gradient(180deg,rgba(31,35,36,.95),rgba(10,13,14,.92));' +
      'border:2px solid #1b1f20;border-top-color:#596260;border-left-color:#596260;border-radius:3px;padding:10px;z-index:12;' +
      'box-shadow:inset 0 0 0 1px rgba(210,177,95,.25),0 12px 30px rgba(0,0,0,.38);';
    this.status = document.createElement('div');
    this.status.style.cssText =
      'padding:7px 8px;background:#101514;border:1px solid #424a47;box-shadow:inset 0 0 12px rgba(0,0,0,.55);color:#d2b15f;';
    this.tabs = document.createElement('div');
    this.tabs.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;';
    this.body = document.createElement('div');
    this.body.style.cssText = 'display:flex;flex-direction:column;gap:7px;overflow:auto;padding-right:1px;';
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
    const selectedBuilding = this.selectedBuilding();
    if (selectedBuilding) {
      this.body.appendChild(this.selectedBuildingHeader(selectedBuilding));
      const context = this.contextTab(selectedBuilding);
      if (context) {
        this.renderCommandList(context, selectedBuilding);
        return;
      }
      const note = document.createElement('div');
      note.style.cssText = 'padding:10px;border:1px solid #333b39;background:#111615;color:#9ba7a2;';
      note.textContent = selectedBuilding.building?.kind === 'refinery' ? 'Ore processing online. Income cycles automatically.' : 'No direct production commands.';
      this.body.appendChild(note);
      return;
    }

    this.renderCommandList(this.activeTab);
  }

  private renderCommandList(tab: Tab, producer?: Entity): void {
    if (tab === 'structures') {
      for (const def of Object.values(STRUCTURES)) {
        const check = canBuildStructure(this.sim, this.economy, def.kind);
        this.body.appendChild(this.card(def.kind, def.label, def.cost, check.ok, check.reason, 'STRUCTURE', () => this.actions.buildStructure(def.kind)));
      }
    } else {
      for (const def of Object.values(UNITS).filter((unit) => unit.tab === tab)) {
        const check = canQueueUnit(this.sim, this.economy, def.kind);
        this.body.appendChild(this.card(def.kind, def.label, def.cost, check.ok, check.reason, 'UNIT', () => this.actions.queueUnit(def.kind, producer)));
      }
      for (const producer of buildings(this.sim).filter((entity) => entity.producer && entity.building?.complete)) {
        const line = document.createElement('div');
        const active = producer.producer?.active;
        line.style.cssText =
          'padding:7px 8px;border:1px solid #2f3735;background:#101514;color:#aebbc4;box-shadow:inset 0 0 10px rgba(0,0,0,.35);';
        line.textContent = `${producer.building?.label}: ${active ? `${active.label} ${Math.round((1 - active.remaining / active.total) * 100)}%` : 'idle'} q${producer.producer?.queue.length ?? 0}`;
        this.body.appendChild(line);
      }
    }
  }

  private card(kind: string, label: string, cost: number, enabled: boolean, reason: string, eyebrow: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.disabled = !enabled;
    button.title = reason;
    button.setAttribute('aria-label', enabled ? `${label} $${cost}` : `${label} ${reason}`);
    button.style.cssText =
      'min-height:68px;text-align:left;padding:6px;display:grid;grid-template-columns:58px 1fr;gap:8px;align-items:stretch;' +
      'border-radius:2px;border:1px solid #58615f;border-top-color:#89908b;border-left-color:#89908b;' +
      `background:${enabled ? 'linear-gradient(180deg,#334143,#1b2527)' : 'linear-gradient(180deg,#2c302f,#171a1a)'};` +
      `color:${enabled ? '#eef3e9' : '#87918a'};cursor:${enabled ? 'pointer' : 'not-allowed'};box-shadow:inset 0 0 0 1px rgba(0,0,0,.5);`;
    const icon = document.createElement('div');
    icon.style.cssText = iconCss(kind, enabled);
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;justify-content:center;min-width:0;';
    const top = document.createElement('div');
    top.style.cssText = 'font-size:9px;color:#d2b15f;letter-spacing:.12em;';
    top.textContent = eyebrow;
    const name = document.createElement('div');
    name.style.cssText = 'font-size:13px;color:inherit;white-space:normal;line-height:1.15;';
    name.textContent = label;
    const meta = document.createElement('div');
    meta.style.cssText = `margin-top:4px;font-size:11px;color:${enabled ? '#b9c7c1' : '#d17a65'};`;
    meta.textContent = enabled ? `$${cost}` : reason;
    content.append(top, name, meta);
    button.append(icon, content);
    button.onclick = action;
    return button;
  }

  private selectedBuildingHeader(entity: Entity): HTMLDivElement {
    const el = document.createElement('div');
    const health = entity.health ? `${Math.ceil(entity.health.current)}/${entity.health.max}` : 'online';
    el.style.cssText =
      'display:grid;grid-template-columns:46px 1fr;gap:8px;align-items:center;padding:8px;border:1px solid #4b5552;' +
      'background:linear-gradient(180deg,#202929,#111615);box-shadow:inset 0 0 14px rgba(0,0,0,.45);';
    const icon = document.createElement('div');
    icon.style.cssText = iconCss(entity.building?.kind ?? 'building', true) + 'min-height:42px;';
    const copy = document.createElement('div');
    copy.innerHTML = `<div style="font-size:10px;color:#d2b15f;letter-spacing:.14em">SELECTED STRUCTURE</div><div style="font-size:14px;color:#f0f3e8">${entity.building?.label ?? entity.name ?? 'Building'}</div><div style="font-size:11px;color:#aebbc4">hull ${health}</div>`;
    el.append(icon, copy);
    return el;
  }

  private selectedBuilding(): Entity | undefined {
    const selected = selectedEntities(this.sim).filter((entity) => entity.building);
    return selected.length === 1 ? selected[0] : undefined;
  }

  private contextTab(entity: Entity): Tab | undefined {
    if (!entity.building?.complete) return undefined;
    if (entity.building.kind === 'command-yard') return 'structures';
    if (entity.building.kind === 'barracks') return 'infantry';
    if (entity.building.kind === 'factory') return 'vehicles';
    return undefined;
  }

  private bodyKey(): string {
    const selected = selectedEntities(this.sim)
      .map((entity) => `${entity.id}:${entity.building?.kind ?? entity.selectable?.type}:${entity.selectable?.selected}`)
      .join('|');
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
      selected,
      completedBuildings,
      producers,
    ].join('~');
  }
}

function buttonCss(active: boolean): string {
  return (
    'height:31px;border-radius:2px;border:1px solid #4b5552;font:10px ui-monospace,Menlo,monospace;letter-spacing:.06em;' +
    `background:${active ? 'linear-gradient(180deg,#d2b15f,#8b7339)' : 'linear-gradient(180deg,#26302f,#111615)'};` +
    `color:${active ? '#141614' : '#d7e0e7'};cursor:pointer;`
  );
}

function iconCss(kind: string, enabled: boolean): string {
  const dim = enabled ? '' : 'filter:grayscale(1) brightness(.62);';
  const base =
    'min-height:54px;border:1px solid #111;background-color:#1f2a2c;background-size:100% 100%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),inset 0 -18px 18px rgba(0,0,0,.35);';
  const art: Record<string, string> = {
    'command-yard':
      'background-image:linear-gradient(135deg,transparent 52%,rgba(210,177,95,.75) 53% 59%,transparent 60%),linear-gradient(180deg,#7b8789 0 45%,#3a4548 46% 100%),linear-gradient(90deg,#202729 0 18%,#596367 19% 82%,#202729 83%);',
    'power-plant':
      'background-image:radial-gradient(circle at 65% 32%,#f4cf65 0 9%,transparent 10%),linear-gradient(90deg,transparent 0 18%,#6c7779 19% 34%,transparent 35% 47%,#6c7779 48% 63%,transparent 64%),linear-gradient(180deg,#435155 0 52%,#1c2729 53%);',
    refinery:
      'background-image:radial-gradient(circle at 70% 25%,#d2b15f 0 8%,transparent 9%),linear-gradient(90deg,#2a322f 0 22%,#83765c 23% 50%,#4c544e 51% 100%),linear-gradient(180deg,#6f715f 0 48%,#222824 49%);',
    barracks:
      'background-image:linear-gradient(135deg,transparent 0 38%,#d2b15f 39% 43%,transparent 44%),linear-gradient(180deg,#667063 0 36%,#2f3a33 37% 100%),linear-gradient(90deg,#1c241f 0 22%,transparent 23% 77%,#1c241f 78%);',
    factory:
      'background-image:linear-gradient(90deg,transparent 0 8%,#d2b15f 9% 13%,transparent 14% 100%),linear-gradient(180deg,#7b8588 0 32%,#3c4649 33% 100%),linear-gradient(90deg,#1d2527 0 34%,#596266 35% 100%);',
    infantry:
      'background-image:linear-gradient(90deg,transparent 0 39%,#d2b15f 40% 47%,transparent 48%),radial-gradient(circle at 52% 26%,#b7c0bb 0 10%,transparent 11%),linear-gradient(180deg,transparent 0 38%,#596760 39% 70%,#252d2b 71%);',
    tank:
      'background-image:linear-gradient(90deg,transparent 0 48%,#d2b15f 49% 91%,transparent 92%),linear-gradient(180deg,transparent 0 40%,#65787f 41% 65%,#263033 66% 100%),linear-gradient(90deg,#182021 0 15%,transparent 16% 84%,#182021 85%);',
  };
  return `${base}${art[kind] ?? art['command-yard']}${dim}`;
}
