import { Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { GameSim } from '../sim/world';
import { issueMoveOrder, selectedEntities, setSelected, stopEntities } from '../sim/world';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import type { Entity } from '../sim/components';
import type { OrderMarkerKind } from '../render/orderMarkerView';
import type { UnitView } from '../render/unitView';
import type { Input } from '../engine/input';

export interface PlacementControls {
  isPlacing(): boolean;
  preview(x: number, z: number): void;
  confirm(x: number, z: number): void;
  cancel(): void;
}

export interface BuildingPicker {
  pickAt(x: number, z: number): Entity | undefined;
}

export interface OrderFeedback {
  showOrder(x: number, z: number, kind: OrderMarkerKind): void;
  showFacingOrder?(x: number, z: number, yaw: number, kind: OrderMarkerKind): void;
  showFacingPreview?(fromX: number, fromZ: number, toX: number, toZ: number, kind: OrderMarkerKind): void;
  clearFacingPreview?(): void;
  tryRally?(x: number, z: number): boolean;
}

interface PointerState {
  x: number;
  y: number;
  button: number;
  time: number;
}

const LEFT_DRAG_THRESHOLD = 6;
const RIGHT_ORDER_DRAG_THRESHOLD = 18;

export class RtsController {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly selectionBox: HTMLDivElement;
  private readonly controlGroups = new Map<number, Entity[]>();
  private pointerDown?: PointerState;
  private rightOrderStart?: { x: number; z: number };
  private lastClick = { time: 0, entity: undefined as Entity | undefined };
  private attackMoveQueued = false;
  private enabled = true;

  constructor(
    private readonly dom: HTMLElement,
    private readonly input: Input,
    private readonly camera: PerspectiveCamera,
    private readonly hf: Heightfield,
    private readonly sim: GameSim,
    private readonly units: UnitView,
    private readonly placement?: PlacementControls,
    private readonly buildings?: BuildingPicker,
    private readonly orderFeedback?: OrderFeedback,
  ) {
    this.selectionBox = document.createElement('div');
    this.selectionBox.style.cssText =
      'position:fixed;border:1px solid rgba(125,242,125,.9);background:rgba(125,242,125,.12);display:none;pointer-events:none;z-index:20;';
    document.body.appendChild(this.selectionBox);

    dom.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  selectedCount(): number {
    return selectedEntities(this.sim).length;
  }

  isRightOrderGestureActive(): boolean {
    return this.enabled && this.pointerDown?.button === 2 && this.rightOrderStart !== undefined;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pointerDown = undefined;
      this.rightOrderStart = undefined;
      this.selectionBox.style.display = 'none';
      this.orderFeedback?.clearFacingPreview?.();
      this.attackMoveQueued = false;
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.metaKey && e.button === 0) return;
    if (e.button === 2 && this.input.isDown('Space')) {
      this.pointerDown = undefined;
      this.rightOrderStart = undefined;
      this.orderFeedback?.clearFacingPreview?.();
      e.preventDefault();
      this.dom.setPointerCapture?.(e.pointerId);
      return;
    }
    if (this.placement?.isPlacing()) {
      this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
      return;
    }
    this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
    this.rightOrderStart = undefined;
    if (e.button === 2 && selectedEntities(this.sim).some((entity) => entity.mover)) {
      this.rightOrderStart = this.terrainPoint(e.clientX, e.clientY);
    }
    if (e.button === 0 || e.button === 2) {
      e.preventDefault();
      this.dom.setPointerCapture?.(e.pointerId);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.enabled) return;
    if (this.placement?.isPlacing()) {
      const p = this.terrainPoint(e.clientX, e.clientY);
      if (p) this.placement.preview(p.x, p.z);
      return;
    }
    if (!this.pointerDown) return;
    if (this.pointerDown.button === 2 && this.rightOrderStart) {
      const dx = e.clientX - this.pointerDown.x;
      const dy = e.clientY - this.pointerDown.y;
      if (Math.hypot(dx, dy) < RIGHT_ORDER_DRAG_THRESHOLD) {
        this.orderFeedback?.clearFacingPreview?.();
        return;
      }
      const p = this.terrainPoint(e.clientX, e.clientY);
      if (p) this.orderFeedback?.showFacingPreview?.(this.rightOrderStart.x, this.rightOrderStart.z, p.x, p.z, this.isAttackMoveQueued() ? 'attack' : 'move');
      return;
    }
    if (this.pointerDown.button !== 0 || e.metaKey) return;
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    if (Math.hypot(dx, dy) < LEFT_DRAG_THRESHOLD) return;
    const minX = Math.min(this.pointerDown.x, e.clientX);
    const minY = Math.min(this.pointerDown.y, e.clientY);
    const maxX = Math.max(this.pointerDown.x, e.clientX);
    const maxY = Math.max(this.pointerDown.y, e.clientY);
    this.selectionBox.style.display = 'block';
    this.selectionBox.style.left = `${minX}px`;
    this.selectionBox.style.top = `${minY}px`;
    this.selectionBox.style.width = `${maxX - minX}px`;
    this.selectionBox.style.height = `${maxY - minY}px`;
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.enabled) return;
    if (!this.pointerDown) return;
    const down = this.pointerDown;
    this.pointerDown = undefined;
    this.selectionBox.style.display = 'none';
    this.orderFeedback?.clearFacingPreview?.();

    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const pointerDistance = Math.hypot(dx, dy);
    const dragged = pointerDistance > (down.button === 2 ? RIGHT_ORDER_DRAG_THRESHOLD : LEFT_DRAG_THRESHOLD);
    if (this.placement?.isPlacing()) {
      const p = this.terrainPoint(e.clientX, e.clientY);
      if (down.button === 0 && p) this.placement.confirm(p.x, p.z);
      if (down.button === 2) this.placement.cancel();
      return;
    }
    if (down.button === 0 && !e.metaKey) {
      if (dragged) {
        const minX = Math.min(down.x, e.clientX);
        const minY = Math.min(down.y, e.clientY);
        const maxX = Math.max(down.x, e.clientX);
        const maxY = Math.max(down.y, e.clientY);
        const hits = this.units.entitiesInScreenRect(this.camera, minX, minY, maxX, maxY, window.innerWidth, window.innerHeight);
        setSelected(this.sim, hits, e.shiftKey);
      } else {
        this.selectClick(e);
      }
    }

    if (down.button === 2) {
      const destinationPoint = dragged ? this.rightOrderStart : this.terrainPoint(e.clientX, e.clientY) ?? this.terrainPoint(down.x, down.y);
      const facingPoint = dragged ? this.terrainPoint(e.clientX, e.clientY) : undefined;
      this.rightOrderStart = undefined;
      if (destinationPoint) {
        if (!dragged && this.orderFeedback?.tryRally?.(destinationPoint.x, destinationPoint.z)) {
          this.attackMoveQueued = false;
          return;
        }
        const selected = selectedEntities(this.sim).filter((entity) => entity.mover);
        const target = this.sim.nav.nearestWalkableCell(destinationPoint.x, destinationPoint.z, 96);
        const attackMove = this.isAttackMoveQueued();
        if (!target) {
          this.attackMoveQueued = false;
          return;
        }
        const destination = this.sim.nav.cellCenter(target.x, target.y);
        let faceYaw: number | undefined;
        if (dragged && destination && facingPoint) {
          const faceDx = facingPoint.x - destination.x;
          const faceDz = facingPoint.z - destination.z;
          if (Math.hypot(faceDx, faceDz) > 2) faceYaw = Math.atan2(faceDx, faceDz);
        }
        if (selected.length > 0) {
          if (issueMoveOrder(this.sim, selected, destination.x, destination.z, attackMove, faceYaw)) {
            this.orderFeedback?.showOrder(destination.x, destination.z, attackMove ? 'attack' : 'move');
            if (faceYaw !== undefined) this.orderFeedback?.showFacingOrder?.(destination.x, destination.z, faceYaw, attackMove ? 'attack' : 'move');
          }
        }
        this.attackMoveQueued = false;
      }
    }
  }

  private selectClick(e: PointerEvent): void {
    const p = this.terrainPoint(e.clientX, e.clientY);
    if (!p) return;
    const hit = this.buildings?.pickAt(p.x, p.z) ?? this.units.pickAt(p.x, p.z);
    if (!hit) {
      if (!e.shiftKey) setSelected(this.sim, []);
      return;
    }
    const now = performance.now();
    if (this.lastClick.entity === hit && now - this.lastClick.time < 320 && hit.selectable) {
      setSelected(this.sim, this.units.visibleOfType(this.camera, hit.selectable.type, window.innerWidth, window.innerHeight), e.shiftKey);
    } else {
      setSelected(this.sim, [hit], e.shiftKey);
    }
    this.lastClick = { time: now, entity: hit };
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;
    if (e.code === 'Escape' && this.placement?.isPlacing()) {
      this.placement.cancel();
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyS' && selectedEntities(this.sim).length > 0) {
      stopEntities(selectedEntities(this.sim));
      e.preventDefault();
    }
    if (e.code === 'KeyA' && selectedEntities(this.sim).some((entity) => entity.weapon)) {
      this.attackMoveQueued = true;
      e.preventDefault();
      return;
    }
    if (!e.code.startsWith('Digit')) return;
    const n = Number(e.code.slice(5));
    if (n < 1 || n > 9) return;
    if (e.ctrlKey || e.metaKey) {
      this.controlGroups.set(n, selectedEntities(this.sim));
      e.preventDefault();
    } else {
      const group = this.controlGroups.get(n);
      if (group) {
        setSelected(this.sim, group.filter((entity) => this.sim.world.has(entity)));
        e.preventDefault();
      }
    }
  }

  private terrainPoint(clientX: number, clientY: number): { x: number; z: number } | undefined {
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const origin = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    let lo = 0;
    let hi = 1600;
    let hit = false;
    for (let i = 0; i < 80; i++) {
      const t = (hi / 80) * i;
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      if (y <= sampleHeight(this.hf, x, z) + 0.3) {
        hi = t;
        lo = Math.max(0, t - hi / 80);
        hit = true;
        break;
      }
    }
    if (!hit) return undefined;
    const p = new Vector3();
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      p.copy(origin).addScaledVector(dir, mid);
      if (p.y > sampleHeight(this.hf, p.x, p.z) + 0.3) lo = mid;
      else hi = mid;
    }
    p.copy(origin).addScaledVector(dir, hi);
    return { x: p.x, z: p.z };
  }

  private isAttackMoveQueued(): boolean {
    return this.attackMoveQueued;
  }
}
