import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity } from '../sim/components';
import { MAX_PRODUCER_JOBS, buildings, canBuildStructure, canQueueUnit, type EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import type { VisibilityGrid } from '../sim/visibility';
import { selectedEntities, type GameSim } from '../sim/world';

type Tab = 'buildings' | 'defense' | 'infantry' | 'vehicles' | 'aircraft';

export interface SidebarActions {
  buildStructure(kind: StructureKind): void;
  cancelStructure(): void;
  queueUnit(kind: UnitKind, producer?: Entity): void;
  cancelUnit(kind: UnitKind, producer?: Entity): void;
  setPrimaryProducer(producer: Entity): void;
  focusMap(x: number, z: number): void;
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
  private lastRadarTick = -1;
  private radarFocus?: { x: number; z: number; ttl: number };
  private readonly fogCanvas: HTMLCanvasElement;
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
      'position:relative;height:170px;background:#060908;border:2px solid #151817;border-top-color:#66706a;border-left-color:#66706a;' +
      'box-shadow:inset 0 0 0 1px rgba(210,177,95,.28),inset 0 0 18px rgba(0,0,0,.75);overflow:hidden;';
    this.radar = document.createElement('canvas');
    this.radar.width = 298;
    this.radar.height = 148;
    this.radar.style.cssText = 'position:absolute;left:8px;right:8px;bottom:8px;width:298px;height:148px;image-rendering:pixelated;background:#07100c;';
    this.radar.addEventListener('pointerdown', (event) => this.onRadarPointerDown(event));
    const radarCtx = this.radar.getContext('2d');
    if (!radarCtx) throw new Error('radar canvas unavailable');
    this.radarCtx = radarCtx;
    this.radarTerrain = this.createRadarTerrain();

    this.status = document.createElement('div');
    this.status.style.cssText =
      'position:absolute;left:8px;right:8px;top:7px;height:16px;padding:0 6px;background:#101514;border:1px solid #424a47;' +
      'box-shadow:inset 0 0 12px rgba(0,0,0,.55);color:#d2b15f;font-size:10px;line-height:16px;white-space:pre;overflow:hidden;';
    radarWrap.append(this.radar, this.status);

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
    if (context && this.activeTab !== context) {
      this.activeTab = context;
      this.renderTabs();
      this.lastBodyKey = '';
    }

    const powerDelta = this.economy.powerProduced - this.economy.powerUsed;
    if (this.notice && this.sim.tick >= this.notice.untilTick) this.notice = undefined;
    const latest = this.notice?.text ?? this.economy.ledger.slice(-1)[0]?.label ?? 'ready';
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
    if (this.sim.tick !== this.lastRadarTick) {
      this.lastRadarTick = this.sim.tick;
      this.drawRadar();
    }
    const bodyKey = this.bodyKey();
    if (bodyKey !== this.lastBodyKey) {
      this.lastBodyKey = bodyKey;
      this.renderBody();
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
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
    if (state.progress > 0 && !state.ready) {
      const sweep = document.createElement('div');
      const pct = Math.max(0, Math.min(100, state.progress * 100));
      sweep.style.cssText =
        `position:absolute;inset:0;background:conic-gradient(rgba(210,177,95,.48) ${pct}%, transparent 0);mix-blend-mode:screen;z-index:3;`;
      icon.appendChild(sweep);
    }
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
    if (state.count > 0) icon.appendChild(badge(state.ready ? 'READY' : `×${state.count}`, !!state.ready));

    const content = document.createElement('div');
    content.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:4px;align-items:end;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:10px;color:inherit;white-space:nowrap;line-height:1.1;overflow:hidden;text-overflow:ellipsis;';
    name.textContent = label;
    const meta = document.createElement('div');
    meta.style.cssText = `font-size:10px;color:${state.unaffordable ? '#ff7666' : state.enabled || state.ready ? '#d2b15f' : '#d17a65'};text-align:right;max-width:50px;overflow:hidden;text-overflow:ellipsis;`;
    meta.textContent = state.enabled || state.ready ? `$${cost}` : state.reason;
    content.append(name, meta);
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

  private miniQueue(entity: Entity): string {
    if (!entity.producer) return '';
    const active = entity.producer.active;
    const activeText = active ? `${initials(active.label)} ${Math.round((1 - active.remaining / active.total) * 100)}%` : 'idle';
    const queued = entity.producer.queue.map((job) => initials(job.label)).join(' ');
    return `${activeText}${queued ? ` · ${queued}` : ''}`;
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

  private selectedBuilding(): Entity | undefined {
    const selected = selectedEntities(this.sim).filter((entity) => entity.building);
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
    const selected = selectedEntities(this.sim)
      .map((entity) => `${entity.id}:${entity.health?.current ?? 0}:${entity.building?.kind ?? entity.selectable?.type}:${entity.selectable?.selected}`)
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
    const line = this.economy.structureLine;
    return [
      this.activeTab,
      Math.floor(this.economy.credits),
      this.economy.powerProduced,
      this.economy.powerUsed,
      `${line?.kind ?? ''}:${line ? Math.round((1 - line.remaining / line.total) * 100) : 0}`,
      this.economy.readyStructure ?? '',
      this.economy.selectedStructure ?? '',
      JSON.stringify(this.economy.primaryProducerIds),
      selected,
      completedBuildings,
      producers,
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
        if (height < this.hf.waterLevel + 0.35) {
          r = 28;
          g = 64;
          b = 86;
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

  private drawRadar(): void {
    if (this.radarFocus) {
      this.radarFocus.ttl -= 1 / 30;
      if (this.radarFocus.ttl <= 0) this.radarFocus = undefined;
    }
    this.radarCtx.drawImage(this.radarTerrain, 0, 0);
    this.radarCtx.fillStyle = 'rgba(0,0,0,.22)';
    this.radarCtx.fillRect(0, 0, this.radar.width, this.radar.height);
    for (const entity of this.sim.world.entities) {
      if (!entity.transform || entity.destroyed) continue;
      if (entity.team?.id !== 1 && !this.fog.isVisibleWorld(entity.transform.x, entity.transform.z)) continue;
      const x = ((entity.transform.x / this.hf.size) + 0.5) * this.radar.width;
      const y = ((entity.transform.z / this.hf.size) + 0.5) * this.radar.height;
      if (x < 0 || y < 0 || x >= this.radar.width || y >= this.radar.height) continue;
      const isBuilding = !!entity.building;
      this.radarCtx.fillStyle = entity.team?.id === 2 ? '#df5742' : entity.selectable?.selected ? '#f0d56a' : '#56d184';
      this.radarCtx.fillRect(Math.round(x) - (isBuilding ? 2 : 1), Math.round(y) - (isBuilding ? 2 : 1), isBuilding ? 4 : 2, isBuilding ? 4 : 2);
    }
    this.drawRadarFog();
    if (this.radarFocus) {
      const x = ((this.radarFocus.x / this.hf.size) + 0.5) * this.radar.width;
      const y = ((this.radarFocus.z / this.hf.size) + 0.5) * this.radar.height;
      this.radarCtx.strokeStyle = '#f0d56a';
      this.radarCtx.lineWidth = 1;
      this.radarCtx.beginPath();
      this.radarCtx.moveTo(x - 6, y);
      this.radarCtx.lineTo(x + 6, y);
      this.radarCtx.moveTo(x, y - 6);
      this.radarCtx.lineTo(x, y + 6);
      this.radarCtx.stroke();
    }
    this.radarCtx.strokeStyle = 'rgba(210,177,95,.65)';
    this.radarCtx.strokeRect(0.5, 0.5, this.radar.width - 1, this.radar.height - 1);
  }

  private drawRadarFog(): void {
    const ctx = this.fogCanvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(this.fog.res, this.fog.res);
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
    this.radarCtx.drawImage(this.fogCanvas, 0, 0, this.radar.width, this.radar.height);
  }

  private onRadarPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.radar.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width;
    const v = (event.clientY - rect.top) / rect.height;
    const x = (u - 0.5) * this.hf.size;
    const z = (v - 0.5) * this.hf.size;
    this.radarFocus = { x, z, ttl: 0.8 };
    this.actions.focusMap(x, z);
    this.drawRadar();
  }
}

function cardCss(state: CardState): string {
  return (
    'height:96px;text-align:left;padding:4px;display:grid;grid-template-rows:1fr auto;gap:3px;align-items:stretch;' +
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

function commandIconPath(kind: string): string {
  return `/assets/ui/command-icons/${kind}.png`;
}
