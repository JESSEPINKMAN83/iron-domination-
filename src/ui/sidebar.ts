import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import { WEAPONS, type WeaponKind } from '../content/phase4';
import type { Entity } from '../sim/components';
import { MAX_PRODUCER_JOBS, buildings, canBuildStructure, canQueueUnit, type EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import type { VisibilityGrid } from '../sim/visibility';
import { selectedEntities, type GameSim } from '../sim/world';
import type { TacticalPing, TacticalPingKind } from '../net/multiplayer';

type Tab = 'buildings' | 'defense' | 'infantry' | 'vehicles' | 'aircraft';

export interface SidebarActions {
  buildStructure(kind: StructureKind): void;
  cancelStructure(): void;
  queueUnit(kind: UnitKind, producer?: Entity): void;
  cancelUnit(kind: UnitKind, producer?: Entity): void;
  setPrimaryProducer(producer: Entity): void;
  focusMap(x: number, z: number): void;
  radarYaw(): number;
  radarViewport(): { x: number; z: number }[];
  beginTacticalPing?(kind: TacticalPingKind): void;
}

interface CardState {
  enabled: boolean;
  reason: string;
  count: number;
  progress: number;
  ready?: boolean;
  active?: boolean;
  unaffordable?: boolean;
}

const TAB_LABELS: Record<Tab, string> = {
  buildings: 'BUILDINGS',
  defense: 'DEFENSE',
  infantry: 'INFANTRY',
  vehicles: 'VEHICLES',
  aircraft: 'AIRCRAFT',
};

export class Sidebar {
  private readonly root: HTMLDivElement;
  private readonly radar: HTMLCanvasElement;
  private readonly radarCtx: CanvasRenderingContext2D;
  private readonly radarTerrain: HTMLCanvasElement;
  private readonly tabs: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private activeTab: Tab = 'buildings';
  private lastStatusText = '';
  private lastBodyKey = '';
  private lastBodyTick = -1;
  private lastRadarTick = -3;
  private lastLiveTick = -2;
  private fogImage?: ImageData;
  private lastSelectedBuildingId?: number;
  private radarFocus?: { x: number; z: number; ttl: number };
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly tacticalButtons = new Map<TacticalPingKind, HTMLButtonElement>();
  private tacticalPings: Array<TacticalPing & { expiresAt: number }> = [];
  private selectedTacticalPing?: TacticalPingKind;
  private notice?: { text: string; untilTick: number };

  constructor(
    private readonly sim: GameSim,
    private readonly hf: Heightfield,
    private readonly economy: EconomyState,
    private readonly fog: VisibilityGrid,
    private readonly actions: SidebarActions,
  ) {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = this.fog.res;
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:10px;right:10px;width:322px;max-height:calc(100vh - 20px);display:flex;flex-direction:column;gap:7px;' +
      'font:12px/1.35 ui-monospace,Menlo,monospace;color:#e0e7dd;background:linear-gradient(180deg,rgba(31,35,36,.96),rgba(10,13,14,.93));' +
      'border:2px solid #1b1f20;border-top-color:#596260;border-left-color:#596260;border-radius:3px;padding:10px;z-index:12;' +
      'box-shadow:inset 0 0 0 1px rgba(210,177,95,.25),0 12px 30px rgba(0,0,0,.38);';
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());

    const radarWrap = document.createElement('div');
    radarWrap.style.cssText =
      'position:relative;display:grid;grid-template-rows:18px auto;gap:6px;padding:7px;background:#060908;border:2px solid #151817;' +
      'border-top-color:#66706a;border-left-color:#66706a;box-shadow:inset 0 0 0 1px rgba(210,177,95,.28),inset 0 0 18px rgba(0,0,0,.75);overflow:hidden;';
    this.radar = document.createElement('canvas');
    this.radar.dataset.role = 'radar-map';
    this.radar.width = 298;
    this.radar.height = 298;
    this.radar.style.cssText = 'display:block;width:100%;aspect-ratio:1 / 1;height:auto;image-rendering:pixelated;background:#07100c;';
    this.radar.addEventListener('pointerdown', (event) => this.onRadarPointerDown(event));
    const radarCtx = this.radar.getContext('2d');
    if (!radarCtx) throw new Error('radar canvas unavailable');
    this.radarCtx = radarCtx;
    this.radarTerrain = this.createRadarTerrain();

    this.status = document.createElement('div');
    this.status.style.cssText =
      'height:18px;padding:0 6px;background:#101514;border:1px solid #424a47;box-sizing:border-box;' +
      'box-shadow:inset 0 0 12px rgba(0,0,0,.55);color:#d2b15f;font-size:10px;line-height:16px;white-space:pre;overflow:hidden;';
    radarWrap.append(this.status, this.radar);
    if (this.actions.beginTacticalPing) radarWrap.append(this.createTacticalControls());

    this.tabs = document.createElement('div');
    this.tabs.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:4px;';
    this.body = document.createElement('div');
    this.body.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;overflow:auto;padding-right:1px;';
    this.root.append(radarWrap, this.tabs, this.body);
    document.body.appendChild(this.root);
    this.renderTabs();
  }

  update(): void {
    if (this.root.style.display === 'none') return;
    const selected = this.selectedBuilding();
    const context = selected ? this.contextTab(selected) : undefined;
    const selectedId = selected?.id;
    if (selectedId !== this.lastSelectedBuildingId) {
      this.lastSelectedBuildingId = selectedId;
      if (context && this.activeTab !== context) {
        this.activeTab = context;
        this.renderTabs();
        this.lastBodyKey = '';
      }
    }

    const powerDelta = this.economy.powerProduced - this.economy.powerUsed;
    if (this.notice && this.sim.tick >= this.notice.untilTick) this.notice = undefined;
    const placing = this.economy.selectedStructure ? `placing ${STRUCTURES[this.economy.selectedStructure].label}` : undefined;
    const latest = placing ?? this.notice?.text ?? this.economy.ledger.slice(-1)[0]?.label ?? 'ready';
    const statusText = [
      `$${Math.floor(this.economy.credits)}`,
      `PWR ${powerDelta >= 0 ? '+' : ''}${powerDelta}${powerDelta < 0 ? ' LOW POWER' : ''}`,
      latest,
    ].join('   ');
    if (statusText !== this.lastStatusText) {
      this.status.textContent = statusText;
      this.status.style.color = powerDelta < 0 ? '#ff7666' : '#d2b15f';
      this.lastStatusText = statusText;
    }
    if (this.sim.tick - this.lastRadarTick >= 3) {
      this.lastRadarTick = this.sim.tick;
      this.drawRadar();
    }
    // the body is a pure function of sim state, which only advances per tick — skip the
    // expensive bodyKey scan on frames where the tick hasn't changed (tab switches call
    // renderBody directly, so they stay responsive)
    if (this.sim.tick !== this.lastBodyTick) {
      this.lastBodyTick = this.sim.tick;
      const bodyKey = this.bodyKey();
      if (bodyKey !== this.lastBodyKey) {
        this.lastBodyKey = bodyKey;
        this.renderBody();
      }
    }
    if (this.sim.tick - this.lastLiveTick >= 2) {
      this.lastLiveTick = this.sim.tick;
      this.updateLivePanel();
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  setTacticalPing(kind?: TacticalPingKind): void {
    this.selectedTacticalPing = kind;
    for (const [buttonKind, button] of this.tacticalButtons) button.style.cssText = tacticalButtonCss(buttonKind === kind);
  }

  addTacticalPing(ping: TacticalPing): void {
    this.tacticalPings = this.tacticalPings.filter((candidate) => candidate.playerId !== ping.playerId || candidate.kind !== ping.kind);
    this.tacticalPings.push({ ...ping, expiresAt: performance.now() + 9000 });
    this.drawRadar();
  }

  producerHighlightIds(): number[] {
    if (this.activeTab === 'buildings' || this.activeTab === 'defense') {
      return buildings(this.sim, this.economy.team)
        .filter((entity) => entity.building?.complete && entity.building.kind === 'command-yard' && !entity.destroyed)
        .map((entity) => entity.id);
    }
    const selected = this.selectedBuilding();
    if (selected && this.contextTab(selected) === this.activeTab && !selected.destroyed) return [selected.id];
    const producers = this.unitProducers(this.activeTab).filter((entity) => !entity.destroyed);
    const primaryId = this.economy.primaryProducerIds[this.activeTab];
    const primary = primaryId ? producers.find((entity) => entity.id === primaryId) : undefined;
    const source =
      primary ??
      producers.reduce<Entity | undefined>((best, entity) => {
        if (!best) return entity;
        return queueDepth(entity) < queueDepth(best) ? entity : best;
      }, undefined);
    return source ? [source.id] : [];
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const tab of ['buildings', 'defense', 'infantry', 'vehicles', 'aircraft'] as const) {
      const button = document.createElement('button');
      button.textContent = TAB_LABELS[tab];
      button.style.cssText = buttonCss(tab === this.activeTab, this.tabHasActivity(tab));
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
    const selected = this.selectedBuilding();
    if (selected) this.body.appendChild(this.selectedBuildingStrip(selected));
    const selectedHarvester = this.selectedHarvester();
    if (selectedHarvester) this.body.appendChild(this.selectedHarvesterStrip(selectedHarvester));
    this.body.appendChild(this.economySummary());

    if (this.activeTab === 'buildings') {
      for (const def of Object.values(STRUCTURES).filter((structure) => structure.tab === 'structures')) {
        this.body.appendChild(
          this.card(def.kind, def.label, def.cost, 'STRUCTURE', this.structureCardState(def.kind), () => this.actions.buildStructure(def.kind), () =>
            this.actions.cancelStructure(),
          ),
        );
      }
      return;
    }

    if (this.activeTab === 'defense') {
      for (const def of Object.values(STRUCTURES).filter((structure) => structure.tab === 'defense')) {
        this.body.appendChild(
          this.card(def.kind, def.label, def.cost, 'DEFENSE', this.structureCardState(def.kind), () => this.actions.buildStructure(def.kind), () =>
            this.actions.cancelStructure(),
          ),
        );
      }
      return;
    }

    const selectedProducer = selected && this.contextTab(selected) === this.activeTab ? selected : undefined;
    const units = Object.values(UNITS).filter((unit) => unit.tab === this.activeTab);
    const hasProducer = this.unitProducers(this.activeTab).length > 0;
    if (!hasProducer) {
      const required =
        this.activeTab === 'vehicles' ? 'FACTORY REQUIRED' : this.activeTab === 'aircraft' ? 'HELIPAD REQUIRED' : 'BARRACKS REQUIRED';
      const detail =
        this.activeTab === 'vehicles'
          ? 'Build and place a Factory before vehicle production opens.'
          : this.activeTab === 'aircraft'
            ? 'Build and place a Helipad before aircraft production opens.'
            : 'Build and place a Barracks before infantry production opens.';
      this.body.appendChild(this.emptyState(required, detail));
      return;
    }
    for (const def of units) {
      this.body.appendChild(
        this.card(def.kind, def.label, def.cost, 'UNIT', this.unitCardState(def.kind, selectedProducer), () => this.actions.queueUnit(def.kind, selectedProducer), () =>
          this.actions.cancelUnit(def.kind, selectedProducer),
        ),
      );
    }
    this.body.appendChild(this.productionSummary(this.activeTab));
  }

  private card(
    kind: string,
    label: string,
    cost: number,
    eyebrow: string,
    state: CardState,
    action: () => void,
    cancel: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.dataset.commandKind = kind;
    button.dataset.commandType = eyebrow;
    button.title = state.enabled ? `${label} $${cost}` : state.reason;
    button.setAttribute('aria-label', state.enabled ? `${label} $${cost}` : `${label} ${state.reason}`);
    button.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
    button.style.cssText = cardCss(state);
    button.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button === 0) {
        if (state.enabled) {
          action();
          this.lastBodyKey = '';
        } else {
          this.flash(state.reason || 'Unavailable');
        }
      } else if (event.button === 2) {
        cancel();
        this.lastBodyKey = '';
      }
    };
    button.oncontextmenu = (event) => {
      event.preventDefault();
    };

    const icon = document.createElement('div');
    icon.style.cssText = commandIconCss(state.enabled || !!state.active || !!state.ready);
    const progress = document.createElement('div');
    progress.dataset.progressKind = kind;
    progress.style.cssText = progressBarCss(state.progress, !!state.active && !state.ready);
    icon.appendChild(progress);
    const fallback = document.createElement('div');
    fallback.style.cssText =
      'position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(180deg,#252b2d,#0d1112);' +
      `color:${state.enabled || state.ready ? '#d2b15f' : '#6f7772'};font-size:18px;z-index:1;`;
    fallback.textContent = initials(label);
    const img = document.createElement('img');
    img.src = commandIconPath(kind);
    img.alt = '';
    img.style.cssText = 'position:relative;z-index:2;width:100%;height:100%;object-fit:cover;display:block;';
    img.onerror = () => img.remove();
    icon.append(fallback, img);
    const countBadge = badge(state.ready ? 'READY' : state.count > 0 ? `×${state.count}` : '', !!state.ready);
    countBadge.dataset.badgeKind = kind;
    countBadge.style.display = state.count > 0 || state.ready ? 'block' : 'none';
    icon.appendChild(countBadge);

    const content = document.createElement('div');
    content.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:3px 4px;align-items:end;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:10px;color:inherit;white-space:nowrap;line-height:1.1;overflow:hidden;text-overflow:ellipsis;';
    name.textContent = label;
    const meta = document.createElement('div');
    meta.dataset.metaKind = kind;
    meta.style.cssText = `font-size:10px;color:${state.unaffordable ? '#ff7666' : state.enabled || state.ready ? '#d2b15f' : '#d17a65'};text-align:right;max-width:50px;overflow:hidden;text-overflow:ellipsis;`;
    meta.textContent = cardMetaText(state, cost);
    content.append(name, meta);
    const unitDetail = unitCardDetail(kind);
    if (unitDetail) {
      const role = document.createElement('div');
      role.style.cssText = 'grid-column:1/-1;font-size:8px;line-height:1;color:#aebbc4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      role.textContent = unitDetail.role.toUpperCase();
      const pips = document.createElement('div');
      pips.style.cssText = 'grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:2px;height:8px;';
      for (const value of unitDetail.pips) pips.appendChild(statPip(value, state.enabled || !!state.ready));
      content.append(role, pips);
    }
    button.append(icon, content);
    return button;
  }

  private structureCardState(kind: StructureKind): CardState {
    const def = STRUCTURES[kind];
    const line = this.economy.structureLine;
    const ready = this.economy.readyStructure === kind;
    const active = line?.kind === kind;
    const check = canBuildStructure(this.sim, this.economy, kind);
    const lineBusy = !!line || !!this.economy.readyStructure;
    return {
      enabled: ready || check.ok,
      reason: ready ? 'Ready to place' : active ? 'Building' : lineBusy ? 'Line busy' : check.reason,
      count: ready || active ? 1 : 0,
      progress: active ? 1 - line!.remaining / line!.total : ready ? 1 : 0,
      ready,
      active,
      unaffordable: !lineBusy && this.economy.credits < def.cost,
    };
  }

  private unitCardState(kind: UnitKind, producer?: Entity): CardState {
    const def = UNITS[kind];
    const check = canQueueUnit(this.sim, this.economy, kind);
    const relevant = this.unitProducers(def.producer, producer);
    const queueFull = relevant.length > 0 && relevant.every((entity) => queueDepth(entity) >= MAX_PRODUCER_JOBS);
    const active = relevant.find((entity) => entity.producer?.active?.kind === kind)?.producer?.active;
    const count = relevant.reduce((sum, entity) => {
      const queue = entity.producer?.queue.filter((job) => job.kind === kind).length ?? 0;
      return sum + queue + (entity.producer?.active?.kind === kind ? 1 : 0);
    }, 0);
    const enabled = check.ok && !queueFull && (!producer || relevant.includes(producer));
    return {
      enabled,
      reason: queueFull ? 'Queue full' : check.reason,
      count,
      progress: active ? 1 - active.remaining / active.total : 0,
      active: !!active,
      unaffordable: this.economy.credits < def.cost,
    };
  }

  private selectedBuildingStrip(entity: Entity): HTMLDivElement {
    const el = document.createElement('div');
    const health = entity.health ? `${Math.ceil(entity.health.current)}/${entity.health.max}` : 'online';
    const producerType = this.contextTab(entity);
    const producerName = producerType === 'infantry' || producerType === 'vehicles' || producerType === 'aircraft' ? producerType : undefined;
    const isPrimary = producerName ? this.economy.primaryProducerIds[producerName] === entity.id : false;
    el.style.cssText =
      'grid-column:1/-1;display:grid;grid-template-columns:46px 1fr auto;gap:8px;align-items:center;padding:8px;border:1px solid #4b5552;' +
      'background:linear-gradient(180deg,#202929,#111615);box-shadow:inset 0 0 14px rgba(0,0,0,.45);';
    const icon = document.createElement('div');
    icon.style.cssText = commandIconCss(true) + 'min-height:42px;';
    const img = document.createElement('img');
    img.src = commandIconPath(entity.building?.kind ?? 'command-yard');
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.onerror = () => img.remove();
    icon.append(img);

    const copy = document.createElement('div');
    const queue = entity.producer ? this.miniQueue(entity) : '<span style="color:#7f8a85">no queue</span>';
    copy.innerHTML =
      `<div style="font-size:10px;color:#d2b15f">SELECTED</div>` +
      `<div style="font-size:14px;color:#f0f3e8">${entity.building?.label ?? entity.name ?? 'Building'}</div>` +
      `<div style="font-size:11px;color:#aebbc4">hull ${health} · ${queue}</div>`;
    copy.appendChild(this.capabilityChips(entity));

    const controls = document.createElement('div');
    controls.style.cssText = 'display:grid;gap:4px;';
    if (entity.producer && producerName) {
      const primary = document.createElement('button');
      primary.textContent = isPrimary ? '★ PRIMARY' : '☆ PRIMARY';
      primary.style.cssText = smallButtonCss(isPrimary);
      primary.onclick = () => this.actions.setPrimaryProducer(entity);
      const rally = document.createElement('div');
      rally.style.cssText = 'font-size:10px;color:#d2b15f;text-align:right;';
      rally.textContent = entity.producer.rally ? 'RALLY SET' : 'RIGHT-CLICK MAP';
      controls.append(primary, rally);
    }

    el.append(icon, copy, controls);
    return el;
  }

  private selectedHarvesterStrip(entity: Entity): HTMLDivElement {
    const el = document.createElement('div');
    const cargo = entity.cargo ? Math.round(entity.cargo.amount) : 0;
    const capacity = entity.cargo?.capacity ?? 0;
    const cargoPct = capacity > 0 ? Math.max(0, Math.min(1, cargo / capacity)) : 0;
    const state = harvesterStateLabel(entity);
    const health = entity.health ? `${Math.ceil(entity.health.current)}/${entity.health.max}` : 'online';
    el.style.cssText =
      'grid-column:1/-1;display:grid;grid-template-columns:46px 1fr;gap:8px;align-items:center;padding:8px;border:1px solid #4b5552;' +
      'background:linear-gradient(180deg,#202929,#111615);box-shadow:inset 0 0 14px rgba(0,0,0,.45);';

    const icon = document.createElement('div');
    icon.style.cssText =
      commandIconCss(true) +
      'min-height:42px;display:grid;place-items:center;color:#151715;background:linear-gradient(180deg,#d2b15f,#7d6531);font-size:17px;';
    icon.textContent = 'ORE';

    const copy = document.createElement('div');
    copy.style.cssText = 'display:grid;gap:4px;min-width:0;';
    const title = document.createElement('div');
    title.innerHTML =
      `<div style="font-size:10px;color:#d2b15f">SELECTED COLLECTOR</div>` +
      `<div style="font-size:14px;color:#f0f3e8">${entity.name ?? 'Ore Harvester'}</div>` +
      `<div style="font-size:11px;color:#aebbc4">hull ${health} · ${state} · cargo ${cargo}/${capacity}</div>`;
    const bar = document.createElement('div');
    bar.style.cssText = 'height:8px;border:1px solid #303936;background:#060908;box-shadow:inset 0 0 6px rgba(0,0,0,.7);overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:${Math.round(cargoPct * 100)}%;background:linear-gradient(90deg,#8b7339,#f0d56a);`;
    bar.appendChild(fill);
    copy.append(title, bar);

    el.append(icon, copy);
    return el;
  }

  private economySummary(): HTMLDivElement {
    const refineries = buildings(this.sim, this.economy.team).filter(
      (entity) => entity.building?.kind === 'refinery' && entity.building.complete && !entity.destroyed,
    ).length;
    const harvesters = Array.from(this.sim.world.entities).filter((entity) => entity.team?.id === this.economy.team && entity.harvester && !entity.destroyed);
    const cargo = harvesters.reduce((sum, entity) => sum + (entity.cargo?.amount ?? 0), 0);
    const capacity = harvesters.reduce((sum, entity) => sum + (entity.cargo?.capacity ?? 0), 0);
    const remainingOre = this.sim.resourceNodes.reduce((sum, node) => sum + Math.max(0, node.remaining), 0);
    const active = harvesters.filter((entity) => entity.harvester?.state === 'gathering' || entity.harvester?.state === 'to-node').length;
    const returning = harvesters.filter((entity) => entity.harvester?.state === 'to-refinery' || entity.harvester?.state === 'depositing').length;
    const status =
      refineries === 0
        ? 'NO REFINERY'
        : harvesters.length === 0
          ? 'NO COLLECTOR'
          : remainingOre <= 0
            ? 'ORE EMPTY'
            : `${active} COLLECTING · ${returning} RETURNING`;

    const el = document.createElement('div');
    el.style.cssText =
      'grid-column:1/-1;display:grid;grid-template-columns:1fr auto;gap:4px 8px;padding:7px 8px;border:1px solid #2f3735;' +
      'background:#101514;color:#aebbc4;box-shadow:inset 0 0 10px rgba(0,0,0,.35);';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:10px;color:#d2b15f;';
    title.textContent = 'ECONOMY';
    const value = document.createElement('div');
    value.dataset.economyStatus = 'true';
    value.style.cssText = 'font-size:10px;color:#f0d56a;text-align:right;';
    value.textContent = status;
    const detail = document.createElement('div');
    detail.dataset.economyDetail = 'true';
    detail.style.cssText = 'grid-column:1/-1;font-size:10px;color:#aebbc4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    detail.textContent = `refineries ${refineries} · collectors ${harvesters.length} · cargo ${Math.round(cargo)}/${capacity} · ore ${Math.round(remainingOre)}`;
    el.append(title, value, detail);
    return el;
  }

  private miniQueue(entity: Entity): string {
    if (!entity.producer) return '';
    const active = entity.producer.active;
    const activeText = active ? `${initials(active.label)} ${Math.round((1 - active.remaining / active.total) * 100)}%` : 'idle';
    const queued = entity.producer.queue.map((job) => initials(job.label)).join(' ');
    return `${activeText}${queued ? ` · ${queued}` : ''}`;
  }

  private capabilityChips(entity: Entity): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;';
    const chips: string[] = [];
    const kind = entity.building?.kind;
    const def = kind ? STRUCTURES[kind as StructureKind] : undefined;
    if (kind === 'command-yard') chips.push('STRUCTURES');
    if (def?.producer) chips.push(`PRODUCES ${def.producer.toUpperCase()}`);
    if (def?.powerProduced) chips.push(`POWER +${def.powerProduced}`);
    if (def?.powerUsed) chips.push(`POWER -${def.powerUsed}`);
    if (kind === 'refinery') chips.push('CREDITS');
    if (def?.weaponKind) chips.push(def.weaponKind === 'aaMissile' ? 'ANTI-AIR' : 'GROUND DEFENSE');
    if (def?.blocksMovement) chips.push('BLOCKS');
    if (chips.length === 0) chips.push('BASE NODE');
    for (const text of chips) {
      const chip = document.createElement('span');
      chip.textContent = text;
      chip.style.cssText =
        'display:inline-block;padding:2px 5px;border:1px solid #3e4744;background:#121817;color:#d2b15f;font-size:9px;line-height:12px;white-space:nowrap;';
      el.appendChild(chip);
    }
    return el;
  }

  private productionSummary(tab: 'infantry' | 'vehicles' | 'aircraft'): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText =
      'grid-column:1/-1;display:grid;gap:4px;padding:7px 8px;border:1px solid #2f3735;background:#101514;color:#aebbc4;box-shadow:inset 0 0 10px rgba(0,0,0,.35);';
    const producers = this.unitProducers(tab);
    if (producers.length === 0) {
      el.textContent =
        tab === 'vehicles'
          ? 'Build a Factory to unlock vehicle production.'
          : tab === 'aircraft'
            ? 'Build a Helipad to unlock aircraft production.'
            : 'Build a Barracks to unlock infantry production.';
      return el;
    }
    for (const producer of producers) {
      const active = producer.producer?.active;
      const primary = this.economy.primaryProducerIds[tab] === producer.id ? ' ★' : '';
      const rally = producer.producer?.rally ? ' ⚑' : '';
      const row = document.createElement('div');
      row.dataset.producerRowId = String(producer.id);
      row.textContent = `${producer.building?.label}${primary}${rally}: ${active ? `${active.label} ${Math.round((1 - active.remaining / active.total) * 100)}%` : 'idle'} q${queueDepth(producer)}/${MAX_PRODUCER_JOBS}`;
      el.appendChild(row);
    }
    return el;
  }

  private emptyState(title: string, detail: string): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText =
      'grid-column:1/-1;min-height:126px;display:grid;grid-template-rows:auto auto;align-content:center;gap:7px;padding:14px;' +
      'border:1px solid #333b39;background:linear-gradient(180deg,#141a19,#0b0f0f);color:#9ba7a2;text-align:center;box-shadow:inset 0 0 18px rgba(0,0,0,.45);';
    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:13px;color:#d2b15f;letter-spacing:.08em;';
    heading.textContent = title;
    const copy = document.createElement('div');
    copy.style.cssText = 'font-size:11px;color:#aebbc4;line-height:1.35;';
    copy.textContent = detail;
    el.append(heading, copy);
    return el;
  }

  private flash(text: string): void {
    this.notice = { text, untilTick: this.sim.tick + 30 };
    this.lastStatusText = '';
  }

  private updateLivePanel(): void {
    this.updateLiveEconomy();
    this.updateLiveProductionRows();
    this.updateLiveCards();
  }

  private updateLiveEconomy(): void {
    const status = this.body.querySelector<HTMLElement>('[data-economy-status="true"]');
    const detail = this.body.querySelector<HTMLElement>('[data-economy-detail="true"]');
    if (!status || !detail) return;
    const refineries = buildings(this.sim, this.economy.team).filter(
      (entity) => entity.building?.kind === 'refinery' && entity.building.complete && !entity.destroyed,
    ).length;
    const harvesters = Array.from(this.sim.world.entities).filter((entity) => entity.team?.id === this.economy.team && entity.harvester && !entity.destroyed);
    const cargo = harvesters.reduce((sum, entity) => sum + (entity.cargo?.amount ?? 0), 0);
    const capacity = harvesters.reduce((sum, entity) => sum + (entity.cargo?.capacity ?? 0), 0);
    const remainingOre = this.sim.resourceNodes.reduce((sum, node) => sum + Math.max(0, node.remaining), 0);
    const active = harvesters.filter((entity) => entity.harvester?.state === 'gathering' || entity.harvester?.state === 'to-node').length;
    const returning = harvesters.filter((entity) => entity.harvester?.state === 'to-refinery' || entity.harvester?.state === 'depositing').length;
    const label =
      refineries === 0
        ? 'NO REFINERY'
        : harvesters.length === 0
          ? 'NO COLLECTOR'
          : remainingOre <= 0
            ? 'ORE EMPTY'
            : `${active} COLLECTING · ${returning} RETURNING`;
    status.textContent = label;
    detail.textContent = `refineries ${refineries} · collectors ${harvesters.length} · cargo ${Math.round(cargo)}/${capacity} · ore ${Math.round(remainingOre)}`;
  }

  private updateLiveProductionRows(): void {
    for (const row of Array.from(this.body.querySelectorAll<HTMLElement>('[data-producer-row-id]'))) {
      const id = Number(row.dataset.producerRowId);
      const producer = buildings(this.sim, this.economy.team).find((entity) => entity.id === id);
      if (!producer?.producer) continue;
      const tab = producer.building?.kind ? STRUCTURES[producer.building.kind as StructureKind]?.producer : undefined;
      const unitTab = tab === 'infantry' || tab === 'vehicles' || tab === 'aircraft' ? tab : undefined;
      const primary = unitTab && this.economy.primaryProducerIds[unitTab] === producer.id ? ' ★' : '';
      const rally = producer.producer.rally ? ' ⚑' : '';
      const active = producer.producer.active;
      row.textContent = `${producer.building?.label}${primary}${rally}: ${active ? `${active.label} ${Math.round((1 - active.remaining / active.total) * 100)}%` : 'idle'} q${queueDepth(producer)}/${MAX_PRODUCER_JOBS}`;
    }
  }

  private updateLiveCards(): void {
    const selected = this.selectedBuilding();
    const selectedProducer = selected && this.contextTab(selected) === this.activeTab ? selected : undefined;
    for (const button of Array.from(this.body.querySelectorAll<HTMLButtonElement>('[data-command-kind]'))) {
      const kind = button.dataset.commandKind;
      if (!kind) continue;
      const state = STRUCTURES[kind as StructureKind]
        ? this.structureCardState(kind as StructureKind)
        : UNITS[kind as UnitKind]
          ? this.unitCardState(kind as UnitKind, selectedProducer)
          : undefined;
      if (!state) continue;
      const progress = button.querySelector<HTMLElement>('[data-progress-kind]');
      if (progress) progress.style.cssText = progressBarCss(state.progress, !!state.active && !state.ready);
      const badgeEl = button.querySelector<HTMLElement>('[data-badge-kind]');
      if (badgeEl) {
        badgeEl.textContent = state.ready ? 'READY' : state.count > 0 ? `×${state.count}` : '';
        badgeEl.style.display = state.count > 0 || state.ready ? 'block' : 'none';
        badgeEl.style.background = state.ready ? '#d2b15f' : '#111615';
        badgeEl.style.color = state.ready ? '#151715' : '#f0d56a';
      }
      const meta = button.querySelector<HTMLElement>('[data-meta-kind]');
      if (meta) {
        const cost = STRUCTURES[kind as StructureKind]?.cost ?? UNITS[kind as UnitKind]?.cost ?? 0;
        meta.textContent = cardMetaText(state, cost);
        meta.style.color = state.unaffordable ? '#ff7666' : state.enabled || state.ready ? '#d2b15f' : '#d17a65';
      }
      const label = STRUCTURES[kind as StructureKind]?.label ?? UNITS[kind as UnitKind]?.label ?? kind;
      const cost = STRUCTURES[kind as StructureKind]?.cost ?? UNITS[kind as UnitKind]?.cost ?? 0;
      button.title = state.enabled ? `${label} $${cost}` : state.reason;
      button.setAttribute('aria-label', state.enabled ? `${label} $${cost}` : `${label} ${state.reason}`);
      button.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
    }
  }

  private selectedBuilding(): Entity | undefined {
    const selected = selectedEntities(this.sim, this.economy.team).filter((entity) => entity.building);
    return selected.length === 1 ? selected[0] : undefined;
  }

  private selectedHarvester(): Entity | undefined {
    const selected = selectedEntities(this.sim, this.economy.team).filter((entity) => entity.harvester);
    return selected.length === 1 ? selected[0] : undefined;
  }

  private contextTab(entity: Entity): Tab | undefined {
    if (!entity.building?.complete) return undefined;
    if (entity.building.kind === 'command-yard') return 'buildings';
    if (entity.building.kind === 'barracks') return 'infantry';
    if (entity.building.kind === 'factory') return 'vehicles';
    if (entity.building.kind === 'helipad') return 'aircraft';
    return undefined;
  }

  private unitProducers(type: 'infantry' | 'vehicles' | 'aircraft', preferred?: Entity): Entity[] {
    const producers = buildings(this.sim, this.economy.team).filter(
      (entity) => entity.producer && entity.building?.complete && STRUCTURES[entity.building.kind as StructureKind]?.producer === type,
    );
    if (preferred && producers.includes(preferred)) return [preferred];
    return producers;
  }

  private tabHasActivity(tab: Tab): boolean {
    if (tab === 'buildings') {
      const kind = this.economy.readyStructure ?? (this.economy.structureLine?.kind as StructureKind | undefined);
      return !!kind && STRUCTURES[kind]?.tab === 'structures';
    }
    if (tab === 'defense') {
      const kind = this.economy.readyStructure ?? (this.economy.structureLine?.kind as StructureKind | undefined);
      return !!kind && STRUCTURES[kind]?.tab === 'defense';
    }
    return this.unitProducers(tab).some((entity) => entity.producer?.active || (entity.producer?.queue.length ?? 0) > 0);
  }

  private bodyKey(): string {
    const selected = selectedEntities(this.sim, this.economy.team)
      .map(
        (entity) =>
          `${entity.id}:${healthBucket(entity)}:${entity.building?.kind ?? entity.selectable?.type}:${entity.selectable?.selected}:${entity.harvester?.state ?? ''}`,
      )
      .join('|');
    const completedBuildings = buildings(this.sim, this.economy.team)
      .filter((entity) => entity.building?.complete)
      .map((entity) => `${entity.id}:${entity.building?.kind}:${entity.building?.buildProgress.toFixed(2) ?? 0}`)
      .join('|');
    const producers = buildings(this.sim, this.economy.team)
      .filter((entity) => entity.producer && entity.building?.complete)
      .map((entity) => {
        const active = entity.producer?.active;
        return `${entity.id}:${active?.kind ?? 'idle'}:${entity.producer?.queue.map((job) => job.kind).join(',')}:${entity.producer?.rally?.x ?? ''}:${entity.producer?.rally?.z ?? ''}`;
      })
      .join('|');
    const harvesters = Array.from(this.sim.world.entities)
      .filter((entity) => entity.team?.id === this.economy.team && entity.harvester && !entity.destroyed)
      .map((entity) => `${entity.id}:${entity.harvester?.state}:${entity.harvester?.nodeId ?? ''}:${entity.harvester?.refineryId ?? ''}`)
      .join('|');
    const line = this.economy.structureLine;
    const visibleCosts =
      this.activeTab === 'buildings' || this.activeTab === 'defense'
        ? Object.values(STRUCTURES)
            .filter((structure) => structure.tab === (this.activeTab === 'buildings' ? 'structures' : 'defense'))
            .map((structure) => `${structure.kind}:${this.economy.credits >= structure.cost}`)
            .join('|')
        : Object.values(UNITS)
            .filter((unit) => unit.tab === this.activeTab)
            .map((unit) => `${unit.kind}:${this.economy.credits >= unit.cost}`)
            .join('|');
    return [
      this.activeTab,
      this.economy.powerProduced,
      this.economy.powerUsed,
      `${line?.kind ?? ''}`,
      this.economy.readyStructure ?? '',
      this.economy.selectedStructure ?? '',
      JSON.stringify(this.economy.primaryProducerIds),
      visibleCosts,
      selected,
      completedBuildings,
      producers,
      harvesters,
    ].join('~');
  }

  private createRadarTerrain(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.radar.width;
    canvas.height = this.radar.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('radar terrain canvas unavailable');
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const gx = Math.floor((x / canvas.width) * this.hf.cells);
        const gz = Math.floor((y / canvas.height) * this.hf.cells);
        const sample = gz * this.hf.samples + gx;
        const walkable = this.hf.walkable[gz * this.hf.cells + gx] > 0;
        const splat = sample * 4;
        const ore = this.hf.splat[splat + 3] / 255;
        const rock = this.hf.splat[splat + 2] / 255;
        const dirt = this.hf.splat[splat + 1] / 255;
        const height = this.hf.heights[sample];
        let r = 38 + dirt * 36 + ore * 48 + rock * 28;
        let g = 72 + dirt * 8 + ore * 28 + rock * 8;
        let b = 38 + dirt * 4 + ore * 12 + rock * 24;
        if (this.hf.kind === 'crater-oasis') {
          r = 132 + dirt * 34 + ore * 52 + rock * 24;
          g = 96 + dirt * 18 + ore * 30 + rock * 10;
          b = 54 + dirt * 4 + ore * 8 + rock * 8;
        } else if (this.hf.kind === 'frostbite-pass') {
          r = 154 + dirt * 8 + ore * 46 + rock * 22;
          g = 174 + dirt * 6 + ore * 28 + rock * 14;
          b = 184 + dirt * 20 + ore * 12 + rock * 18;
        }
        if (height < this.hf.waterLevel + 0.35) {
          if (this.hf.kind === 'crater-oasis') {
            r = 18;
            g = 104;
            b = 112;
          } else if (this.hf.kind === 'frostbite-pass') {
            r = 128;
            g = 178;
            b = 196;
          } else {
            r = 28;
            g = 64;
            b = 86;
          }
        } else if (!walkable) {
          r *= 0.62;
          g *= 0.62;
          b *= 0.62;
        }
        const i = (y * canvas.width + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  private createTacticalControls(): HTMLDivElement {
    const root = document.createElement('div');
    root.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;';
    const items: Array<[TacticalPingKind, string]> = [
      ['attack', 'ATTACK'],
      ['help', 'HELP'],
      ['defend', 'DEFEND'],
      ['good-game', 'GG'],
    ];
    for (const [kind, label] of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = `${label}: choose a map location`;
      button.style.cssText = tacticalButtonCss(false);
      button.onclick = () => {
        this.setTacticalPing(kind);
        this.actions.beginTacticalPing?.(kind);
      };
      this.tacticalButtons.set(kind, button);
      root.appendChild(button);
    }
    return root;
  }

  private drawRadar(): void {
    const now = performance.now();
    this.tacticalPings = this.tacticalPings.filter((ping) => ping.expiresAt > now);
    if (this.radarFocus) {
      this.radarFocus.ttl -= 1 / 30;
      if (this.radarFocus.ttl <= 0) this.radarFocus = undefined;
    }
    this.drawOrientedRadarImage(this.radarTerrain);
    this.radarCtx.fillStyle = 'rgba(0,0,0,.22)';
    this.radarCtx.fillRect(0, 0, this.radar.width, this.radar.height);
    this.drawRadarResources();
    for (const entity of this.sim.world.entities) {
      if (!entity.transform || entity.destroyed) continue;
      if (entity.team?.id !== this.economy.team && !this.fog.isVisibleWorld(entity.transform.x, entity.transform.z)) continue;
      const p = this.worldToRadar(entity.transform.x, entity.transform.z);
      if (p.x < 0 || p.y < 0 || p.x >= this.radar.width || p.y >= this.radar.height) continue;
      const isBuilding = !!entity.building;
      this.radarCtx.fillStyle = entity.team?.id !== this.economy.team ? '#df5742' : entity.selectable?.selected ? '#f0d56a' : '#56d184';
      this.radarCtx.fillRect(Math.round(p.x) - (isBuilding ? 2 : 1), Math.round(p.y) - (isBuilding ? 2 : 1), isBuilding ? 4 : 2, isBuilding ? 4 : 2);
    }
    this.drawRadarFog();
    this.drawRadarViewport();
    this.drawTacticalPings(now);
    if (this.radarFocus) {
      const p = this.worldToRadar(this.radarFocus.x, this.radarFocus.z);
      this.radarCtx.strokeStyle = '#f0d56a';
      this.radarCtx.lineWidth = 1;
      this.radarCtx.beginPath();
      this.radarCtx.moveTo(p.x - 6, p.y);
      this.radarCtx.lineTo(p.x + 6, p.y);
      this.radarCtx.moveTo(p.x, p.y - 6);
      this.radarCtx.lineTo(p.x, p.y + 6);
      this.radarCtx.stroke();
    }
    this.radarCtx.strokeStyle = 'rgba(210,177,95,.65)';
    this.radarCtx.strokeRect(0.5, 0.5, this.radar.width - 1, this.radar.height - 1);
  }

  private drawTacticalPings(now: number): void {
    for (const ping of this.tacticalPings) {
      const p = this.worldToRadar(ping.x, ping.z);
      if (p.x < -12 || p.y < -12 || p.x > this.radar.width + 12 || p.y > this.radar.height + 12) continue;
      const remaining = Math.max(0, Math.min(1, (ping.expiresAt - now) / 9000));
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.012 + ping.playerIndex * 1.7);
      const color = ping.kind === 'attack' ? '#ff6d5e' : ping.kind === 'defend' ? '#63c6ff' : ping.kind === 'help' ? '#f0d56a' : '#7df27d';
      this.radarCtx.save();
      this.radarCtx.globalAlpha = Math.min(1, remaining * 1.35);
      this.radarCtx.strokeStyle = color;
      this.radarCtx.fillStyle = color;
      this.radarCtx.lineWidth = 1.8;
      this.radarCtx.beginPath();
      this.radarCtx.arc(p.x, p.y, 4 + pulse * 7, 0, Math.PI * 2);
      this.radarCtx.stroke();
      this.radarCtx.globalAlpha = 0.9;
      this.radarCtx.beginPath();
      this.radarCtx.arc(p.x, p.y, 2.3 + pulse * 1.5, 0, Math.PI * 2);
      this.radarCtx.fill();
      this.radarCtx.restore();
    }
  }

  private drawRadarResources(): void {
    for (const node of this.sim.resourceNodes) {
      if (node.remaining <= 0.5) continue;
      const p = this.worldToRadar(node.x, node.z);
      if (p.x < -10 || p.y < -10 || p.x > this.radar.width + 10 || p.y > this.radar.height + 10) continue;
      const pct = Math.max(0.12, Math.min(1, node.remaining / node.capacity));
      const radius = Math.max(3, (node.radius / this.hf.size) * Math.min(this.radar.width, this.radar.height) * 1.25);
      this.radarCtx.save();
      this.radarCtx.globalAlpha = 0.4 + pct * 0.35;
      this.radarCtx.fillStyle = '#d2b15f';
      this.radarCtx.strokeStyle = '#151715';
      this.radarCtx.lineWidth = 1;
      this.radarCtx.beginPath();
      this.radarCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      this.radarCtx.fill();
      this.radarCtx.stroke();
      this.radarCtx.restore();
    }
  }

  private drawRadarViewport(): void {
    const footprint = this.actions.radarViewport();
    if (footprint.length < 4) return;
    const points = footprint.map((point) => this.worldToRadar(point.x, point.z));
    this.radarCtx.save();
    this.radarCtx.beginPath();
    this.radarCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) this.radarCtx.lineTo(points[i].x, points[i].y);
    this.radarCtx.closePath();
    this.radarCtx.fillStyle = 'rgba(240,213,106,.08)';
    this.radarCtx.fill();
    this.radarCtx.strokeStyle = 'rgba(8,12,10,.85)';
    this.radarCtx.lineWidth = 3;
    this.radarCtx.stroke();
    this.radarCtx.strokeStyle = 'rgba(240,213,106,.92)';
    this.radarCtx.lineWidth = 1.4;
    this.radarCtx.stroke();
    this.radarCtx.restore();
  }

  private drawRadarFog(): void {
    const ctx = this.fogCanvas.getContext('2d');
    if (!ctx) return;
    const image = (this.fogImage ??= ctx.createImageData(this.fog.res, this.fog.res));
    for (let i = 0; i < this.fog.state.length; i++) {
      const alpha = this.fog.state[i] === 2 ? 0 : this.fog.state[i] === 1 ? 96 : 225;
      const o = i * 4;
      image.data[o] = 4;
      image.data[o + 1] = 7;
      image.data[o + 2] = 8;
      image.data[o + 3] = alpha;
    }
    ctx.putImageData(image, 0, 0);
    this.radarCtx.imageSmoothingEnabled = true;
    this.drawOrientedRadarImage(this.fogCanvas);
  }

  private onRadarPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.radar.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width;
    const v = (event.clientY - rect.top) / rect.height;
    const { x, z } = this.radarToWorld(u, v);
    this.radarFocus = { x, z, ttl: 0.8 };
    this.actions.focusMap(x, z);
    this.drawRadar();
  }

  private worldToRadar(x: number, z: number): { x: number; y: number } {
    return {
      x: (x / this.hf.size + 0.5) * this.radar.width,
      y: (0.5 - z / this.hf.size) * this.radar.height,
    };
  }

  private radarToWorld(u: number, v: number): { x: number; z: number } {
    return {
      x: (u - 0.5) * this.hf.size,
      z: (0.5 - v) * this.hf.size,
    };
  }

  private drawOrientedRadarImage(image: HTMLCanvasElement): void {
    this.radarCtx.save();
    this.radarCtx.translate(0, this.radar.height);
    this.radarCtx.scale(1, -1);
    this.radarCtx.drawImage(image, 0, 0, this.radar.width, this.radar.height);
    this.radarCtx.restore();
  }
}

function cardCss(state: CardState): string {
  return (
    'height:108px;text-align:left;padding:4px;display:grid;grid-template-rows:1fr auto;gap:3px;align-items:stretch;' +
    'border-radius:2px;border:1px solid #58615f;border-top-color:#89908b;border-left-color:#89908b;' +
    `background:${state.ready ? 'linear-gradient(180deg,#6d5e2d,#2a2416)' : state.enabled ? 'linear-gradient(180deg,#334143,#1b2527)' : 'linear-gradient(180deg,#2c302f,#171a1a)'};` +
    `color:${state.enabled || state.ready ? '#eef3e9' : '#87918a'};cursor:${state.enabled ? 'pointer' : 'default'};box-shadow:inset 0 0 0 1px rgba(0,0,0,.5);`
  );
}

function buttonCss(active: boolean, activity: boolean): string {
  return (
    'height:31px;border-radius:2px;border:1px solid #4b5552;font:8px ui-monospace,Menlo,monospace;letter-spacing:0;' +
    `background:${active ? 'linear-gradient(180deg,#d2b15f,#8b7339)' : activity ? 'linear-gradient(180deg,#3f3b25,#151816)' : 'linear-gradient(180deg,#26302f,#111615)'};` +
    `color:${active ? '#141614' : activity ? '#f0d56a' : '#d7e0e7'};cursor:pointer;`
  );
}

function smallButtonCss(active: boolean): string {
  return (
    'height:23px;border-radius:2px;border:1px solid #4b5552;font:10px ui-monospace,Menlo,monospace;letter-spacing:0;padding:0 6px;' +
    `background:${active ? 'linear-gradient(180deg,#d2b15f,#8b7339)' : 'linear-gradient(180deg,#26302f,#111615)'};` +
    `color:${active ? '#141614' : '#d7e0e7'};cursor:pointer;`
  );
}

function commandIconCss(enabled: boolean): string {
  return (
    'position:relative;min-height:62px;border:1px solid #111;background:#111615;overflow:hidden;' +
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),inset 0 -18px 18px rgba(0,0,0,.35);' +
    (enabled ? '' : 'filter:grayscale(1) brightness(.62);')
  );
}

function progressBarCss(progress: number, active: boolean): string {
  const pct = Math.max(0, Math.min(100, progress * 100));
  return (
    'position:absolute;left:0;right:0;top:0;height:5px;z-index:3;pointer-events:none;background:rgba(0,0,0,.55);' +
    `opacity:${active ? '1' : '0'};transition:opacity 120ms ease;` +
    `--progress:${pct}%;` +
    `box-shadow:${active ? '0 0 8px rgba(240,213,106,.2)' : 'none'};` +
    `background:linear-gradient(90deg,#f0d56a 0 var(--progress),rgba(0,0,0,.58) var(--progress) 100%);`
  );
}

function tacticalButtonCss(active: boolean): string {
  return (
    'height:22px;border:1px solid #4b5552;border-radius:1px;font:9px ui-monospace,Menlo,monospace;letter-spacing:0;padding:0 3px;' +
    `background:${active ? 'linear-gradient(180deg,#d2b15f,#8b7339)' : 'linear-gradient(180deg,#25302e,#111615)'};` +
    `color:${active ? '#161713' : '#d7e0e7'};cursor:pointer;`
  );
}

function cardMetaText(state: CardState, cost: number): string {
  if (state.enabled || state.ready || state.unaffordable) return `$${cost}`;
  return state.reason;
}

function badge(text: string, ready: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:absolute;right:3px;top:3px;z-index:4;padding:1px 4px;border:1px solid rgba(0,0,0,.55);font-size:10px;line-height:14px;' +
    `background:${ready ? '#d2b15f' : '#111615'};color:${ready ? '#151715' : '#f0d56a'};box-shadow:0 1px 4px rgba(0,0,0,.45);`;
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

function queueDepth(entity: Entity): number {
  return (entity.producer?.queue.length ?? 0) + (entity.producer?.active ? 1 : 0);
}

function harvesterStateLabel(entity: Entity): string {
  switch (entity.harvester?.state) {
    case 'to-node':
      return 'driving to ore';
    case 'gathering':
      return 'collecting';
    case 'to-refinery':
      return 'returning';
    case 'depositing':
      return 'depositing';
    default:
      return entity.cargo && entity.cargo.amount > 0 ? 'loaded' : 'searching';
  }
}

function healthBucket(entity: Entity): number {
  if (!entity.health || entity.health.max <= 0) return 0;
  return Math.round((Math.max(0, entity.health.current) / entity.health.max) * 20);
}

function commandIconPath(kind: string): string {
  return `/assets/ui/command-icons/${kind}.png`;
}

function unitCardDetail(kind: string): { role: string; pips: number[] } | undefined {
  const unit = UNITS[kind as UnitKind];
  if (!unit) return undefined;
  const primary = primaryWeaponForUnit(unit.kind);
  const weapon = WEAPONS[primary];
  const secondary = secondaryWeaponForUnit(unit.kind);
  const secondaryDef = secondary ? WEAPONS[secondary] : undefined;
  const salvo = bombSalvoForUnit(unit.kind);
  const burstDamage = secondaryDef?.kind === 'bomb' ? secondaryDef.damage * salvo : (secondaryDef?.damage ?? 0);
  const damage = Math.min(1, Math.max(weapon.damage, burstDamage) / 104);
  const range = Math.min(1, Math.max(weapon.range, secondaryDef?.range ?? 0) / 188);
  const speed = speedScoreForUnit(unit.kind);
  const air = weapon.canTargetAir ? Math.min(1, weapon.vs.air) : secondary === 'aaMissile' ? 0.88 : 0;
  return { role: unit.role, pips: [damage, range, speed, air] };
}

function primaryWeaponForUnit(kind: UnitKind): WeaponKind {
  if (kind === 'infantry') return 'rifle';
  if (kind === 'sniper') return 'sniperRifle';
  if (kind === 'grenadier') return 'grenade';
  if (kind === 'rocket-infantry') return 'rocketLauncher';
  if (kind === 'scout-tank') return 'autocannon';
  if (kind === 'tank') return 'cannon';
  if (kind === 'siege-tank') return 'heavyCannon';
  if (kind === 'wasp') return 'waspAutocannon';
  if (kind === 'vulture') return 'rocketPod';
  return 'agMissile';
}

function secondaryWeaponForUnit(kind: UnitKind): WeaponKind | undefined {
  if (kind === 'rocket-infantry') return 'aaMissile';
  if (kind === 'scout-tank' || kind === 'tank' || kind === 'siege-tank' || kind === 'wasp' || kind === 'vulture' || kind === 'hammerhead') {
    return 'bomb';
  }
  return undefined;
}

function bombSalvoForUnit(kind: UnitKind): number {
  if (kind === 'siege-tank' || kind === 'hammerhead') return 4;
  if (kind === 'tank' || kind === 'vulture') return 2;
  if (kind === 'scout-tank' || kind === 'wasp') return 1;
  return 0;
}

function speedScoreForUnit(kind: UnitKind): number {
  const scores: Record<UnitKind, number> = {
    infantry: 0.22,
    sniper: 0.19,
    grenadier: 0.2,
    'rocket-infantry': 0.18,
    'scout-tank': 0.48,
    tank: 0.36,
    'siege-tank': 0.26,
    wasp: 1,
    vulture: 0.76,
    hammerhead: 0.56,
  };
  return scores[kind];
}

function statPip(value: number, active: boolean): HTMLDivElement {
  const el = document.createElement('div');
  const pct = Math.max(6, Math.round(Math.max(0, Math.min(1, value)) * 100));
  el.style.cssText =
    'position:relative;overflow:hidden;border:1px solid rgba(0,0,0,.55);background:#101514;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);';
  const fill = document.createElement('div');
  fill.style.cssText = `height:100%;width:${pct}%;background:${active ? '#d2b15f' : '#5f6762'};`;
  el.appendChild(fill);
  return el;
}
