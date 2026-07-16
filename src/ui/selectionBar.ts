import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity } from '../sim/components';
import { selectedEntities, type GameSim } from '../sim/world';
import {
  hasUnitUpgrade,
  unitKindForUpgrade,
  upgradeOptionsForKind,
  type UnitUpgradeId,
  type UpgradePurchaseResult,
} from '../sim/upgrades';

interface SelectionGroup {
  key: string;
  kind: string;
  label: string;
  type: string;
  entities: Entity[];
  healthPct?: number;
  unitKind?: UnitKind;
}

export class SelectionBar {
  private readonly root: HTMLDivElement;
  private lastKey = '';
  private visible = true;

  constructor(
    private readonly sim: GameSim,
    private readonly actions: {
      selectEntities: (entities: Entity[]) => void;
      credits: () => number;
      purchaseUpgrade: (ids: number[], upgradeId: UnitUpgradeId) => UpgradePurchaseResult;
    },
    private readonly localTeam = 1,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'game-selection-bar';
    this.root.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:13;display:none;' +
      'width:min(720px,calc(100vw - 36px));pointer-events:auto;color:#e0e7dd;font:12px/1.35 ui-monospace,Menlo,monospace;' +
      'background:linear-gradient(180deg,rgba(24,31,31,.94),rgba(8,12,12,.9));border:2px solid #1b1f20;border-top-color:#596260;border-left-color:#596260;' +
      'border-radius:3px;padding:9px 10px;box-shadow:inset 0 0 0 1px rgba(210,177,95,.25),0 12px 30px rgba(0,0,0,.38);';
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
    document.body.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) this.root.style.display = 'none';
    else this.lastKey = '';
  }

  update(): void {
    if (!this.visible) return;
    const selected = selectedEntities(this.sim, this.localTeam).filter((entity) => !entity.destroyed);
    if (selected.length === 0) {
      this.lastKey = '';
      this.root.style.display = 'none';
      return;
    }
    const groups = selectionGroups(selected);
    const key = groups
      .map((group) => `${group.key}:${group.entities.map((entity) => `${entity.id}.${entity.unitUpgrades?.ids.join('+') ?? ''}`).join(',')}:${group.healthPct ?? ''}`)
      .join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.render(groups, selected.length);
  }

  private render(groups: SelectionGroup[], selectedCount: number): void {
    this.root.replaceChildren();
    this.root.style.display = 'grid';
    this.root.style.gap = '8px';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
    const title = document.createElement('div');
    title.textContent = 'SELECTED FORCE';
    title.style.cssText = 'font-size:12px;color:#d2b15f;letter-spacing:.08em;';
    const count = document.createElement('div');
    count.textContent = `${selectedCount} ${selectedCount === 1 ? 'ITEM' : 'ITEMS'}`;
    count.style.cssText = 'font-size:12px;color:#f0f3e8;text-align:right;';
    header.append(title, count);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;gap:8px;overflow-x:auto;padding-bottom:1px;';
    for (const group of groups) grid.appendChild(this.groupButton(group, selectedCount));

    this.root.append(header, grid);
  }

  private groupButton(group: SelectionGroup, selectedCount: number): HTMLDivElement {
    const active = group.entities.length === selectedCount;
    const button = document.createElement('div');
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.title = `Select ${group.entities.length} ${group.label}`;
    button.setAttribute('aria-label', `Select ${group.entities.length} ${group.label}`);
    button.style.cssText =
      'flex:0 0 136px;min-height:92px;text-align:left;padding:5px;display:grid;grid-template-rows:48px auto;gap:4px;align-items:stretch;' +
      'border-radius:2px;border:1px solid #4b5552;border-top-color:#757f7a;border-left-color:#757f7a;' +
      `background:${active ? 'linear-gradient(180deg,#4f4728,#1d2018)' : 'linear-gradient(180deg,#26302f,#121817)'};` +
      'color:#eef3e9;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.48);';
    button.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.actions.selectEntities(group.entities);
      this.lastKey = '';
      this.update();
    };
    button.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.actions.selectEntities(group.entities);
      this.lastKey = '';
      this.update();
    };
    button.oncontextmenu = (event) => event.preventDefault();

    const icon = document.createElement('div');
    icon.style.cssText =
      'position:relative;min-height:48px;border:1px solid #111;background:#111615;overflow:hidden;' +
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),inset 0 -18px 18px rgba(0,0,0,.35);';
    const fallback = document.createElement('div');
    fallback.style.cssText =
      'position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(180deg,#252b2d,#0d1112);color:#d2b15f;font-size:15px;z-index:1;';
    fallback.textContent = initials(group.label);
    const img = document.createElement('img');
    img.src = commandIconPath(group.kind);
    img.alt = '';
    img.style.cssText = 'position:relative;z-index:2;width:100%;height:100%;object-fit:cover;display:block;';
    img.onerror = () => img.remove();
    icon.append(fallback, img, badge(`×${group.entities.length}`, active));
    if (group.unitKind) icon.appendChild(this.upgradeButton(group));

    const copy = document.createElement('div');
    copy.style.cssText = 'display:grid;gap:2px;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:11px;color:#f0f3e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1;';
    name.textContent = group.label;
    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:10px;color:#aebbc4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1;';
    const health = group.healthPct === undefined ? '' : ` · ${group.healthPct}% HP`;
    meta.textContent = `${group.type}${health}`;
    copy.append(name, meta);
    button.append(icon, copy);
    return button;
  }

  private upgradeButton(group: SelectionGroup): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '↑';
    button.title = `Upgrade ${group.label}`;
    button.setAttribute('aria-label', `Upgrade ${group.label}`);
    button.style.cssText =
      'position:absolute;left:3px;top:3px;z-index:6;width:24px;height:24px;padding:0;display:grid;place-items:center;' +
      'border:1px solid #d2b15f;background:#101716;color:#f0d56a;font:bold 18px/1 ui-monospace,Menlo,monospace;cursor:pointer;' +
      'box-shadow:0 2px 6px rgba(0,0,0,.55);';
    button.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openUpgradePopover(group, button);
    };
    button.onkeydown = (event) => event.stopPropagation();
    return button;
  }

  private openUpgradePopover(group: SelectionGroup, anchor: HTMLElement): void {
    this.root.querySelector('[data-upgrade-popover]')?.remove();
    if (!group.unitKind) return;
    const popover = document.createElement('div');
    popover.dataset.upgradePopover = 'true';
    popover.style.cssText =
      'position:absolute;left:50%;bottom:calc(100% + 9px);transform:translateX(-50%);width:min(440px,calc(100vw - 40px));' +
      'display:grid;gap:8px;padding:10px;background:linear-gradient(180deg,#1d2625,#0b1110);border:1px solid #717b74;' +
      'box-shadow:0 16px 36px rgba(0,0,0,.55),inset 0 0 0 1px rgba(210,177,95,.18);z-index:20;';
    popover.onpointerdown = (event) => event.stopPropagation();

    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;color:#f0d56a;font-size:12px;';
    const ownedSummary = group.entities.reduce((sum, entity) => sum + (entity.unitUpgrades?.ids.length ?? 0), 0);
    heading.innerHTML = `<span>UPGRADE ${escapeHtml(group.label.toUpperCase())}</span><span style="color:#b8c3bf">$${Math.floor(this.actions.credits())} · ${ownedSummary} INSTALLED</span>`;
    popover.appendChild(heading);

    for (const def of upgradeOptionsForKind(group.unitKind)) {
      const owned = group.entities.filter((entity) => hasUnitUpgrade(entity, def.id)).length;
      const missing = group.entities.length - owned;
      const totalCost = missing * def.cost;
      const affordable = this.actions.credits() >= totalCost;
      const row = document.createElement('button');
      row.type = 'button';
      row.disabled = missing === 0 || !affordable;
      row.style.cssText =
        'width:100%;display:grid;grid-template-columns:1fr auto;gap:7px 12px;text-align:left;padding:9px;border:1px solid #46514e;' +
        `background:${missing === 0 ? '#18211b' : affordable ? '#202a28' : '#241b19'};color:#eef3e9;cursor:${row.disabled ? 'default' : 'pointer'};opacity:${missing === 0 ? '.72' : '1'};`;
      const state = missing === 0 ? 'INSTALLED' : `$${totalCost}`;
      const stateColor = missing === 0 ? '#78df8b' : affordable ? '#f0d56a' : '#ff7d67';
      row.innerHTML =
        `<strong style="font-size:12px">${escapeHtml(def.label)}${def.hotkey ? ` <span style="color:#72e6d0">[${def.hotkey}]</span>` : ''}</strong>` +
        `<strong style="font-size:12px;color:${stateColor}">${state}</strong>` +
        `<span style="grid-column:1/-1;color:#aebbc4;font-size:10px;line-height:1.35">${escapeHtml(def.description)}</span>` +
        `<span style="grid-column:1/-1;color:#76847f;font-size:9px">${owned}/${group.entities.length} OWN THIS · $${def.cost} PER UNIT</span>`;
      row.onclick = () => {
        const result = this.actions.purchaseUpgrade(group.entities.map((entity) => entity.id), def.id);
        this.showPurchaseResult(popover, result);
        this.lastKey = '';
      };
      popover.appendChild(row);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'CLOSE';
    close.style.cssText = 'justify-self:end;padding:4px 8px;border:1px solid #46514e;background:#111817;color:#b8c3bf;cursor:pointer;font:10px ui-monospace,Menlo,monospace;';
    close.onclick = () => popover.remove();
    popover.appendChild(close);
    this.root.appendChild(popover);
    anchor.blur();
  }

  private showPurchaseResult(popover: HTMLElement, result: UpgradePurchaseResult): void {
    const existing = popover.querySelector('[data-purchase-result]');
    existing?.remove();
    const status = document.createElement('div');
    status.dataset.purchaseResult = 'true';
    status.textContent = result.reason;
    status.style.cssText = `font-size:10px;color:${result.ok ? '#78df8b' : '#ff7d67'};`;
    popover.appendChild(status);
    if (result.ok) setTimeout(() => this.update(), 0);
  }
}

function selectionGroups(entities: Entity[]): SelectionGroup[] {
  const map = new Map<string, SelectionGroup>();
  for (const entity of entities) {
    const descriptor = selectionDescriptor(entity);
    const existing = map.get(descriptor.key);
    if (existing) existing.entities.push(entity);
    else map.set(descriptor.key, { ...descriptor, entities: [entity] });
  }
  for (const group of map.values()) group.healthPct = averageHealthPct(group.entities);
  return Array.from(map.values());
}

function selectionDescriptor(entity: Entity): Omit<SelectionGroup, 'entities' | 'healthPct'> {
  if (entity.building?.kind) {
    const def = STRUCTURES[entity.building.kind as StructureKind];
    return {
      key: `building:${entity.building.kind}`,
      kind: entity.building.kind,
      label: entity.building.label ?? def?.label ?? entity.name ?? 'Building',
      type: 'BUILDING',
    };
  }
  if (entity.harvester) return { key: 'unit:harvester', kind: 'harvester', label: entity.name ?? 'Ore Harvester', type: 'ECONOMY' };
  const unitKind = unitKindForUpgrade(entity);
  if (unitKind) {
    const unit = UNITS[unitKind];
    return { key: `unit:${unitKind}`, kind: unitKind, label: unit.label, type: unit.tab.toUpperCase(), unitKind };
  }
  const type = entity.selectable?.type ?? 'unit';
  return { key: `unit:${type}`, kind: type, label: entity.name ?? typeLabel(type), type: type.toUpperCase() };
}

function averageHealthPct(entities: Entity[]): number | undefined {
  let sum = 0;
  let count = 0;
  for (const entity of entities) {
    if (!entity.health || entity.health.max <= 0) continue;
    sum += Math.max(0, Math.min(1, entity.health.current / entity.health.max));
    count++;
  }
  return count > 0 ? Math.round((sum / count) * 100) : undefined;
}

function badge(text: string, active: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:absolute;right:3px;top:3px;z-index:4;padding:1px 4px;border:1px solid rgba(0,0,0,.55);font-size:10px;line-height:14px;' +
    `background:${active ? '#d2b15f' : '#111615'};color:${active ? '#151715' : '#f0d56a'};box-shadow:0 1px 4px rgba(0,0,0,.45);`;
  return el;
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function typeLabel(type: string): string {
  return type
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
}

function commandIconPath(kind: string): string {
  return `/assets/ui/command-icons/${kind}.png`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}
