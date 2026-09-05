import './tacticPlanner.css';
import type { MapId, MapSize } from '../content/maps';
import type { Entity, TacticEndAction } from '../sim/components';
import { areTeamsHostile, type GameSim } from '../sim/world';
import { MAX_TACTIC_WAYPOINTS, tacticEligibleEntities } from '../sim/tactics';
import { createTacticalMapRaster, mapPercentToWorld, worldToMapPercent } from './tacticalMap';
import { unitDisplayName } from './unitDisplayName';

export type TacticPlannerMapContext = {
  mapId: MapId;
  mapSize: MapSize;
  seed: number;
  oreAmount?: number;
  terrainRelief?: number;
  /** World-space anchor for the local army (HQ / spawn). Used to orient the map. */
  localAnchor: { x: number; z: number };
  /** Fog-of-war visibility. Hidden armies must never be revealed by the planner. */
  isVisible?: (x: number, z: number) => boolean;
};

export type TacticExecutePayload = {
  entityIds: number[];
  waypoints: Array<{ x: number; z: number }>;
  endAction: TacticEndAction;
  selectionCount: number;
  plannerDurationMs: number;
  highSpeed: boolean;
};

type EndMode = 'hold' | 'attack-move' | 'attack';

const ENEMY_PICK_RADIUS = 28;
const HIGH_SPEED_STORAGE_KEY = 'iron-dominion.tactic-high-speed.v1';

export class TacticPlanner {
  private overlay?: HTMLDivElement;
  private mapCanvas?: HTMLCanvasElement;
  private overlayCanvas?: HTMLCanvasElement;
  private unitList?: HTMLDivElement;
  private statusEl?: HTMLDivElement;
  private executeBtn?: HTMLButtonElement;
  private worldSize = 1;
  private flipX = false;
  private flipY = false;
  private openedAt = 0;
  private candidates: Entity[] = [];
  private selectedIds = new Set<number>();
  private waypoints: Array<{ x: number; z: number }> = [];
  private endMode: EndMode = 'hold';
  private attackTargetId?: number;
  private highSpeed = false;
  private onKeyDown?: (event: KeyboardEvent) => void;
  private lastDynamicRefreshAt = 0;

  constructor(
    private readonly sim: GameSim,
    private readonly localTeam: number,
    private readonly map: TacticPlannerMapContext,
    private readonly callbacks: {
      onOpen?: () => void;
      onCancel?: (meta: { plannerDurationMs: number; selectionCount: number }) => void;
      onExecute: (payload: TacticExecutePayload) => void;
    },
  ) {}

  get isOpen(): boolean {
    return !!this.overlay;
  }

  open(entities: Entity[]): void {
    if (this.overlay) this.close({ silent: true });
    const eligible = tacticEligibleEntities(entities);
    if (eligible.length === 0) return;

    this.candidates = eligible;
    this.selectedIds = new Set(eligible.map((entity) => entity.id));
    this.waypoints = [];
    this.endMode = 'hold';
    this.attackTargetId = undefined;
    this.highSpeed = loadHighSpeedPreference();
    this.openedAt = performance.now();
    this.lastDynamicRefreshAt = 0;
    this.callbacks.onOpen?.();

    const raster = createTacticalMapRaster(
      this.map.mapId,
      this.map.mapSize,
      this.map.seed,
      384,
      this.map.oreAmount,
      this.map.terrainRelief,
    );
    this.worldSize = raster.worldSize;
    const orientation = mapOrientationForPlayer(this.worldSize, this.map.localAnchor, this.enemyAnchor());
    this.flipX = orientation.flipX;
    this.flipY = orientation.flipY;

    const overlay = document.createElement('div');
    overlay.id = 'iron-tactic-planner';
    overlay.className = 'iron-tactic__overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Define tactic');
    overlay.innerHTML = `
      <div class="iron-tactic__dialog">
        <header class="iron-tactic__header">
          <div>
            <p>COMMAND</p>
            <h2>Define Tactic</h2>
          </div>
          <button type="button" class="iron-tactic__close" aria-label="Close">×</button>
        </header>
        <p class="iron-tactic__intro">Select units, click the map to place up to ${MAX_TACTIC_WAYPOINTS} path points, choose what they do at the end, then execute. The match keeps running. Map is oriented with your army at the bottom.</p>
        <div class="iron-tactic__body">
          <div class="iron-tactic__map-pane">
            <div class="iron-tactic__map-wrap">
              <canvas class="iron-tactic__terrain" width="${raster.width}" height="${raster.height}" aria-hidden="true"></canvas>
              <canvas class="iron-tactic__overlay-canvas" width="${raster.width}" height="${raster.height}"></canvas>
              <div class="iron-tactic__edge iron-tactic__edge--enemy" aria-hidden="true">ENEMY LINES</div>
              <div class="iron-tactic__edge iron-tactic__edge--you" aria-hidden="true">YOUR LINES</div>
            </div>
            <div class="iron-tactic__legend" aria-hidden="true">
              <span><i class="is-you"></i>YOU / IN PLAN</span>
              <span><i class="is-friendly"></i>FRIENDLY</span>
              <span><i class="is-enemy"></i>ENEMY</span>
              <span><i class="is-hq"></i>YOUR HQ</span>
            </div>
            <div class="iron-tactic__map-hint" data-tactic-status></div>
          </div>
          <aside class="iron-tactic__side">
            <div class="iron-tactic__section-title">Units in plan</div>
            <div class="iron-tactic__units" data-tactic-units></div>
            <label class="iron-tactic__speed-option">
              <input type="checkbox" data-tactic-high-speed ${this.highSpeed ? 'checked' : ''}>
              <span><strong>High speed</strong><small>Use rapid transit for the entire path</small></span>
            </label>
            <div class="iron-tactic__section-title">End action</div>
            <div class="iron-tactic__end-actions" role="group" aria-label="End action">
              <button type="button" data-end="hold" class="is-active">Hold</button>
              <button type="button" data-end="attack-move">Attack-move</button>
              <button type="button" data-end="attack">Attack unit</button>
            </div>
            <div class="iron-tactic__path-actions">
              <button type="button" data-action="undo">Undo point</button>
              <button type="button" data-action="clear">Clear path</button>
            </div>
            <div class="iron-tactic__footer">
              <button type="button" class="iron-tactic__cancel" data-action="cancel">Cancel</button>
              <button type="button" class="iron-tactic__execute" data-action="execute" disabled>Execute tactic</button>
            </div>
          </aside>
        </div>
      </div>
    `;

    const terrain = overlay.querySelector<HTMLCanvasElement>('.iron-tactic__terrain')!;
    const terrainCtx = terrain.getContext('2d');
    if (terrainCtx) blitOrientedRaster(terrainCtx, raster, this.flipX, this.flipY);

    this.mapCanvas = terrain;
    this.overlayCanvas = overlay.querySelector('.iron-tactic__overlay-canvas')!;
    this.unitList = overlay.querySelector('[data-tactic-units]')!;
    this.statusEl = overlay.querySelector('[data-tactic-status]')!;
    this.executeBtn = overlay.querySelector('[data-action="execute"]')!;
    this.overlay = overlay;

    overlay.querySelector('.iron-tactic__close')!.addEventListener('click', () => this.cancel());
    overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => this.cancel());
    overlay.querySelector('[data-action="undo"]')!.addEventListener('click', () => {
      this.waypoints.pop();
      this.syncChrome();
    });
    overlay.querySelector('[data-action="clear"]')!.addEventListener('click', () => {
      this.waypoints = [];
      this.attackTargetId = undefined;
      this.syncChrome();
    });
    this.executeBtn.addEventListener('click', () => this.execute());
    const highSpeedInput = overlay.querySelector<HTMLInputElement>('[data-tactic-high-speed]')!;
    highSpeedInput.addEventListener('change', () => {
      this.highSpeed = highSpeedInput.checked;
      saveHighSpeedPreference(this.highSpeed);
      this.syncChrome();
    });

    for (const button of Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-end]'))) {
      button.addEventListener('click', () => {
        this.endMode = button.dataset.end as EndMode;
        if (this.endMode !== 'attack') this.attackTargetId = undefined;
        this.syncChrome();
      });
    }

    this.overlayCanvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handleMapPointer(event);
    });

    overlay.addEventListener('pointerdown', (event) => event.stopPropagation());
    overlay.querySelector('.iron-tactic__dialog')!.addEventListener('click', (event) => event.stopPropagation());

    this.onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);

    document.body.appendChild(overlay);
    document.body.classList.add('iron-tactic-open');
    this.renderUnitList();
    this.syncChrome();
    this.redrawOverlay();
  }

  update(): void {
    if (!this.overlay) return;
    const now = performance.now();
    if (now - this.lastDynamicRefreshAt < 100) return;
    this.lastDynamicRefreshAt = now;

    // Drop dead units from the candidate list while the match keeps playing.
    const previousCandidateCount = this.candidates.length;
    this.candidates = this.candidates.filter((entity) => !entity.destroyed && this.sim.world.has(entity));
    let chromeChanged = this.candidates.length !== previousCandidateCount;
    for (const id of [...this.selectedIds]) {
      if (!this.candidates.some((entity) => entity.id === id)) {
        this.selectedIds.delete(id);
        chromeChanged = true;
      }
    }
    if (this.attackTargetId !== undefined) {
      const target = [...this.sim.world.entities].find((entity) => entity.id === this.attackTargetId);
      if (!target || target.destroyed || !this.isEntityVisible(target)) {
        this.attackTargetId = undefined;
        chromeChanged = true;
      }
    }
    if (chromeChanged) {
      this.renderUnitList();
      this.syncChrome();
    }
    this.redrawOverlay();
  }

  close(options: { silent?: boolean } = {}): void {
    if (!this.overlay) return;
    if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown);
    this.onKeyDown = undefined;
    this.overlay.remove();
    this.overlay = undefined;
    this.mapCanvas = undefined;
    this.overlayCanvas = undefined;
    this.unitList = undefined;
    this.statusEl = undefined;
    this.executeBtn = undefined;
    document.body.classList.remove('iron-tactic-open');
    void options;
  }

  private cancel(): void {
    const duration = Math.round(performance.now() - this.openedAt);
    const selectionCount = this.selectedIds.size;
    this.close();
    this.callbacks.onCancel?.({ plannerDurationMs: duration, selectionCount });
  }

  private execute(): void {
    const endAction = this.resolveEndAction();
    if (!endAction || this.waypoints.length === 0 || this.selectedIds.size === 0) return;
    const payload: TacticExecutePayload = {
      entityIds: [...this.selectedIds],
      waypoints: this.waypoints.map((point) => ({ ...point })),
      endAction,
      selectionCount: this.candidates.length,
      plannerDurationMs: Math.round(performance.now() - this.openedAt),
      highSpeed: this.highSpeed,
    };
    this.close({ silent: true });
    this.callbacks.onExecute(payload);
  }

  private resolveEndAction(): TacticEndAction | undefined {
    if (this.endMode === 'hold') return { kind: 'hold' };
    if (this.endMode === 'attack-move') return { kind: 'attack-move' };
    if (this.endMode === 'attack' && this.attackTargetId !== undefined) {
      return { kind: 'attack', targetId: this.attackTargetId };
    }
    return undefined;
  }

  private handleMapPointer(event: PointerEvent): void {
    if (!this.overlayCanvas) return;
    const rect = this.overlayCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const percentX = ((event.clientX - rect.left) / rect.width) * 100;
    const percentY = ((event.clientY - rect.top) / rect.height) * 100;
    const world = viewPercentToWorld(this.worldSize, percentX, percentY, this.flipX, this.flipY);

    if (this.endMode === 'attack') {
      const enemy = this.pickHostileNear(world.x, world.z);
      if (enemy) {
        this.attackTargetId = enemy.id;
        this.syncChrome();
        this.redrawOverlay();
        return;
      }
    }

    if (this.waypoints.length >= MAX_TACTIC_WAYPOINTS) return;
    this.waypoints.push(world);
    this.syncChrome();
    this.redrawOverlay();
  }

  private pickHostileNear(x: number, z: number): Entity | undefined {
    let best: Entity | undefined;
    let bestDist = ENEMY_PICK_RADIUS;
    for (const entity of this.sim.world.entities) {
      if (entity.destroyed || !entity.team || !entity.health) continue;
      if (!areTeamsHostile(this.sim, this.localTeam, entity.team.id)) continue;
      if (!this.isEntityVisible(entity)) continue;
      const dist = Math.hypot(entity.transform.x - x, entity.transform.z - z);
      if (dist < bestDist) {
        best = entity;
        bestDist = dist;
      }
    }
    return best;
  }

  private renderUnitList(): void {
    if (!this.unitList) return;
    this.unitList.replaceChildren();
    for (const entity of this.candidates) {
      const row = document.createElement('label');
      row.className = 'iron-tactic__unit';
      const checked = this.selectedIds.has(entity.id);
      row.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}/><span>${escapeHtml(unitDisplayName(entity))}</span>`;
      const input = row.querySelector('input')!;
      input.onchange = () => {
        if (input.checked) this.selectedIds.add(entity.id);
        else this.selectedIds.delete(entity.id);
        this.syncChrome();
        this.redrawOverlay();
      };
      this.unitList.appendChild(row);
    }
  }

  private syncChrome(): void {
    if (!this.overlay) return;
    for (const button of Array.from(this.overlay.querySelectorAll<HTMLButtonElement>('[data-end]'))) {
      button.classList.toggle('is-active', button.dataset.end === this.endMode);
    }
    const canExecute =
      this.selectedIds.size > 0 &&
      this.waypoints.length > 0 &&
      (this.endMode !== 'attack' || this.attackTargetId !== undefined);
    if (this.executeBtn) this.executeBtn.disabled = !canExecute;

    if (this.statusEl) {
      const parts = [
        `${this.waypoints.length}/${MAX_TACTIC_WAYPOINTS} path points`,
        `${this.selectedIds.size} units`,
        this.highSpeed ? 'high speed' : 'normal speed',
      ];
      if (this.endMode === 'attack') {
        parts.push(this.attackTargetId !== undefined ? `target #${this.attackTargetId}` : 'click an enemy on the map');
      } else {
        parts.push(this.endMode === 'hold' ? 'end: hold' : 'end: attack-move');
      }
      this.statusEl.textContent = parts.join(' · ');
    }
  }

  private redrawOverlay(): void {
    const canvas = this.overlayCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const toView = (x: number, z: number): { x: number; y: number } => {
      const point = worldToViewPercent(this.worldSize, x, z, this.flipX, this.flipY);
      return {
        x: (point.x / 100) * canvas.width,
        y: (point.y / 100) * canvas.height,
      };
    };

    // Soft side tints reinforce "you bottom / enemy top".
    const youTint = ctx.createLinearGradient(0, canvas.height * 0.55, 0, canvas.height);
    youTint.addColorStop(0, 'rgba(86,209,132,0)');
    youTint.addColorStop(1, 'rgba(86,209,132,0.14)');
    ctx.fillStyle = youTint;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const enemyTint = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.4);
    enemyTint.addColorStop(0, 'rgba(223,87,66,0.16)');
    enemyTint.addColorStop(1, 'rgba(223,87,66,0)');
    ctx.fillStyle = enemyTint;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const hq = toView(this.map.localAnchor.x, this.map.localAnchor.z);
    drawHqMarker(ctx, hq.x, hq.y);

    for (const entity of this.sim.world.entities) {
      if (entity.destroyed || !entity.team) continue;
      const point = toView(entity.transform.x, entity.transform.z);
      const hostile = areTeamsHostile(this.sim, this.localTeam, entity.team.id);
      const mine = entity.team.id === this.localTeam;
      if (!mine && !this.isEntityVisible(entity)) continue;
      const selected = this.selectedIds.has(entity.id);
      const isTarget = entity.id === this.attackTargetId;
      const isBuilding = !!entity.building;

      if (selected) {
        ctx.strokeStyle = 'rgba(240,213,106,.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(point.x, point.y, isBuilding ? 6 : 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = isTarget
        ? '#ffb347'
        : hostile
          ? '#df5742'
          : selected
            ? '#f0d56a'
            : mine
              ? '#56d184'
              : '#7aa7ff';
      const size = isBuilding ? (mine ? 5 : 4) : selected || isTarget ? 3.8 : 2.4;
      ctx.fillRect(Math.round(point.x - size / 2), Math.round(point.y - size / 2), size, size);
    }

    if (this.waypoints.length > 0) {
      ctx.strokeStyle = 'rgba(240,213,106,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.waypoints.forEach((waypoint, index) => {
        const point = toView(waypoint.x, waypoint.z);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();

      this.waypoints.forEach((waypoint, index) => {
        const point = toView(waypoint.x, waypoint.z);
        ctx.fillStyle = index === this.waypoints.length - 1 ? '#f0d56a' : '#d2b15f';
        ctx.beginPath();
        ctx.arc(point.x, point.y, index === 0 ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111513';
        ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), point.x, point.y);
      });
    }
  }

  private enemyAnchor(): { x: number; z: number } | undefined {
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (const entity of this.sim.world.entities) {
      if (entity.destroyed || !entity.team || !entity.building) continue;
      if (!areTeamsHostile(this.sim, this.localTeam, entity.team.id)) continue;
      if (!this.isEntityVisible(entity)) continue;
      sumX += entity.transform.x;
      sumZ += entity.transform.z;
      count += 1;
    }
    if (count === 0) {
      for (const entity of this.sim.world.entities) {
        if (entity.destroyed || !entity.team || !entity.mover) continue;
        if (!areTeamsHostile(this.sim, this.localTeam, entity.team.id)) continue;
        if (!this.isEntityVisible(entity)) continue;
        sumX += entity.transform.x;
        sumZ += entity.transform.z;
        count += 1;
      }
    }
    return count > 0 ? { x: sumX / count, z: sumZ / count } : undefined;
  }

  private isEntityVisible(entity: Entity): boolean {
    return entity.team?.id === this.localTeam ||
      (this.map.isVisible?.(entity.transform.x, entity.transform.z) ?? true);
  }
}

function loadHighSpeedPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(HIGH_SPEED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveHighSpeedPreference(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(HIGH_SPEED_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function worldToViewPercent(
  worldSize: number,
  x: number,
  z: number,
  flipX: boolean,
  flipY: boolean,
): { x: number; y: number } {
  const point = worldToMapPercent(worldSize, x, z);
  return {
    x: flipX ? 100 - point.x : point.x,
    y: flipY ? 100 - point.y : point.y,
  };
}

function viewPercentToWorld(
  worldSize: number,
  percentX: number,
  percentY: number,
  flipX: boolean,
  flipY: boolean,
): { x: number; z: number } {
  return mapPercentToWorld(
    worldSize,
    flipX ? 100 - percentX : percentX,
    flipY ? 100 - percentY : percentY,
  );
}

/** Flip the survey so the local army sits toward the bottom and enemies toward the top. */
export function mapOrientationForPlayer(
  worldSize: number,
  localAnchor: { x: number; z: number },
  enemyAnchor?: { x: number; z: number },
): { flipX: boolean; flipY: boolean } {
  const youRaw = worldToMapPercent(worldSize, localAnchor.x, localAnchor.z);
  let flipY = youRaw.y < 50;
  const flipX = false;

  if (enemyAnchor) {
    const foeRaw = worldToMapPercent(worldSize, enemyAnchor.x, enemyAnchor.z);
    const youY = flipY ? 100 - youRaw.y : youRaw.y;
    const foeY = flipY ? 100 - foeRaw.y : foeRaw.y;
    // Enemy should read higher on the board (smaller view Y). If not, invert.
    if (foeY >= youY) flipY = !flipY;
  }

  return { flipX, flipY };
}

function blitOrientedRaster(
  ctx: CanvasRenderingContext2D,
  raster: { width: number; height: number; pixels: Uint8ClampedArray },
  flipX: boolean,
  flipY: boolean,
): void {
  const { width, height, pixels } = raster;
  const image = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = flipX ? width - 1 - x : x;
      const sy = flipY ? height - 1 - y : y;
      const src = (sy * width + sx) * 4;
      const dst = (y * width + x) * 4;
      image.data[dst] = pixels[src];
      image.data[dst + 1] = pixels[src + 1];
      image.data[dst + 2] = pixels[src + 2];
      image.data[dst + 3] = pixels[src + 3];
    }
  }
  ctx.putImageData(image, 0, 0);
}

function drawHqMarker(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(240,213,106,.22)';
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f0d56a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(7, 0);
  ctx.lineTo(0, 7);
  ctx.lineTo(-7, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#f0d56a';
  ctx.font = 'bold 9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('YOUR HQ', 0, 10);
  ctx.restore();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
