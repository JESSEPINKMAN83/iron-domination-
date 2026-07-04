import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from '../content/phase3';
import type { Entity } from '../sim/components';
import { buildings, canBuildStructure, canQueueUnit, type EconomyState } from '../sim/economy';
import type { Heightfield } from '../sim/heightfield';
import { selectedEntities, type GameSim } from '../sim/world';

type Tab = 'structures' | 'infantry' | 'vehicles';

export interface SidebarActions {
  buildStructure(kind: StructureKind): void;
  queueUnit(kind: UnitKind, producer?: Entity): void;
  focusMap(x: number, z: number): void;
}

export class Sidebar {
  private readonly root: HTMLDivElement;
  private readonly radar: HTMLCanvasElement;
  private readonly radarCtx: CanvasRenderingContext2D;
  private readonly radarTerrain: HTMLCanvasElement;
  private readonly tabs: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private activeTab: Tab = 'structures';
  private lastStatusText = '';
  private lastBodyKey = '';
  private lastRadarTick = -1;
  private radarFocus?: { x: number; z: number; ttl: number };

  constructor(private readonly sim: GameSim, private readonly hf: Heightfield, private readonly economy: EconomyState, private readonly actions: SidebarActions) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:10px;right:10px;width:318px;max-height:calc(100vh - 20px);display:flex;flex-direction:column;gap:7px;' +
      'font:12px/1.35 ui-monospace,Menlo,monospace;color:#e0e7dd;background:linear-gradient(180deg,rgba(31,35,36,.95),rgba(10,13,14,.92));' +
      'border:2px solid #1b1f20;border-top-color:#596260;border-left-color:#596260;border-radius:3px;padding:10px;z-index:12;' +
      'box-shadow:inset 0 0 0 1px rgba(210,177,95,.25),0 12px 30px rgba(0,0,0,.38);';
    const radarWrap = document.createElement('div');
    radarWrap.style.cssText =
      'position:relative;height:170px;background:#060908;border:2px solid #151817;border-top-color:#66706a;border-left-color:#66706a;' +
      'box-shadow:inset 0 0 0 1px rgba(210,177,95,.28),inset 0 0 18px rgba(0,0,0,.75);overflow:hidden;';
    this.radar = document.createElement('canvas');
    this.radar.width = 294;
    this.radar.height = 148;
    this.radar.style.cssText = 'position:absolute;left:8px;right:8px;bottom:8px;width:294px;height:148px;image-rendering:pixelated;background:#07100c;';
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
    this.tabs.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;';
    this.body = document.createElement('div');
    this.body.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;overflow:auto;padding-right:1px;';
    this.root.append(radarWrap, this.tabs, this.body);
    document.body.appendChild(this.root);
    this.renderTabs();
  }

  update(): void {
    const statusText = [
      `$${Math.floor(this.economy.credits)}`,
      `PWR ${this.economy.powerProduced - this.economy.powerUsed >= 0 ? '+' : ''}${this.economy.powerProduced - this.economy.powerUsed}`,
      this.economy.ledger.slice(-1)[0]?.label ?? 'ready',
    ].join('   ');
    if (statusText !== this.lastStatusText) {
      this.status.textContent = statusText;
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
      note.style.cssText = 'grid-column:1/-1;padding:10px;border:1px solid #333b39;background:#111615;color:#9ba7a2;';
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
          'grid-column:1/-1;padding:7px 8px;border:1px solid #2f3735;background:#101514;color:#aebbc4;box-shadow:inset 0 0 10px rgba(0,0,0,.35);';
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
      'height:96px;text-align:left;padding:4px;display:grid;grid-template-rows:1fr auto;gap:3px;align-items:stretch;' +
      'border-radius:2px;border:1px solid #58615f;border-top-color:#89908b;border-left-color:#89908b;' +
      `background:${enabled ? 'linear-gradient(180deg,#334143,#1b2527)' : 'linear-gradient(180deg,#2c302f,#171a1a)'};` +
      `color:${enabled ? '#eef3e9' : '#87918a'};cursor:${enabled ? 'pointer' : 'not-allowed'};box-shadow:inset 0 0 0 1px rgba(0,0,0,.5);`;
    const icon = document.createElement('div');
    icon.style.cssText = commandIconCss(enabled);
    const img = document.createElement('img');
    img.src = commandIconPath(kind);
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    const fallback = document.createElement('div');
    fallback.style.cssText =
      'position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(180deg,#252b2d,#0d1112);' +
      `color:${enabled ? '#d2b15f' : '#6f7772'};font-size:18px;letter-spacing:.04em;`;
    fallback.textContent = label
      .split(/\s+/)
      .map((word) => word[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
    img.onerror = () => {
      img.remove();
    };
    icon.append(fallback, img);
    const content = document.createElement('div');
    content.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:3px;align-items:end;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:10px;color:inherit;white-space:nowrap;line-height:1.1;overflow:hidden;text-overflow:ellipsis;';
    name.textContent = label;
    const meta = document.createElement('div');
    meta.style.cssText = `font-size:10px;color:${enabled ? '#d2b15f' : '#d17a65'};text-align:right;`;
    meta.textContent = enabled ? `$${cost}` : reason;
    content.append(name, meta);
    button.append(icon, content);
    button.onclick = action;
    return button;
  }

  private selectedBuildingHeader(entity: Entity): HTMLDivElement {
    const el = document.createElement('div');
    const health = entity.health ? `${Math.ceil(entity.health.current)}/${entity.health.max}` : 'online';
    el.style.cssText =
      'grid-column:1/-1;display:grid;grid-template-columns:46px 1fr;gap:8px;align-items:center;padding:8px;border:1px solid #4b5552;' +
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
      const x = ((entity.transform.x / this.hf.size) + 0.5) * this.radar.width;
      const y = ((entity.transform.z / this.hf.size) + 0.5) * this.radar.height;
      if (x < 0 || y < 0 || x >= this.radar.width || y >= this.radar.height) continue;
      const isBuilding = !!entity.building;
      this.radarCtx.fillStyle = entity.team?.id === 2 ? '#df5742' : entity.selectable?.selected ? '#f0d56a' : '#56d184';
      this.radarCtx.fillRect(Math.round(x) - (isBuilding ? 2 : 1), Math.round(y) - (isBuilding ? 2 : 1), isBuilding ? 4 : 2, isBuilding ? 4 : 2);
    }
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

function buttonCss(active: boolean): string {
  return (
    'height:31px;border-radius:2px;border:1px solid #4b5552;font:10px ui-monospace,Menlo,monospace;letter-spacing:.06em;' +
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

function commandIconPath(kind: string): string {
  return `/assets/ui/command-icons/${kind}.png`;
}
