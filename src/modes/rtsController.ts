import { Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { GameSim } from '../sim/world';
import { areTeamsHostile, attackStandoffPoint, formationSpreadForEntities, issueMoveOrder, selectedEntities, setSelected, stopEntities } from '../sim/world';
import { issueAttackOrder } from '../sim/combat';
import { issueHarvesterReturnOrder, issueHarvestOrder } from '../sim/economy';
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
  showFacingOrder?(x: number, z: number, yaw: number, kind: OrderMarkerKind, length?: number, count?: number): void;
  showFacingPreview?(fromX: number, fromZ: number, toX: number, toZ: number, kind: OrderMarkerKind, count?: number): void;
  clearFacingPreview?(): void;
  showTargetHover?(target: Entity): void;
  clearTargetHover?(): void;
  tryRally?(x: number, z: number): boolean;
}

export interface RtsCommandSink {
  move?(entityIds: number[], x: number, z: number, attackMove: boolean, faceYaw?: number, formationSpread?: number): boolean;
  attack?(entityIds: number[], targetId: number): boolean;
  harvest?(entityIds: number[], x: number, z: number): boolean;
  returnHarvesters?(entityIds: number[], x: number, z: number): boolean;
  stop?(entityIds: number[]): boolean;
  rally?(producerId: number, x: number, z: number): boolean;
}

export interface TacticalPingControls {
  isActive(): boolean;
  confirm(x: number, z: number): void;
  cancel(): void;
}

interface PointerState {
  x: number;
  y: number;
  button: number;
  time: number;
}

const LEFT_DRAG_THRESHOLD = 6;
const RIGHT_ORDER_DRAG_THRESHOLD = 18;
const CAMERA_LOOK_DRAG_THRESHOLD = 4;

export class RtsController {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly selectionBox: HTMLDivElement;
  private readonly controlGroups = new Map<number, Entity[]>();
  private pointerDown?: PointerState;
  private rightOrderStart?: { x: number; z: number };
  private rightCameraLookCandidate = false;
  private rightCameraLookActive = false;
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
    private readonly localTeam = 1,
    private readonly commandSink?: RtsCommandSink,
    private readonly tacticalPing?: TacticalPingControls,
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
    return selectedEntities(this.sim, this.localTeam).length;
  }

  isRightOrderGestureActive(): boolean {
    return this.enabled && this.pointerDown?.button === 2 && this.rightOrderStart !== undefined;
  }

  isEmptyRightLookActive(): boolean {
    return this.enabled && this.pointerDown?.button === 2 && this.rightCameraLookActive;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pointerDown = undefined;
      this.rightOrderStart = undefined;
      this.rightCameraLookCandidate = false;
      this.rightCameraLookActive = false;
      this.selectionBox.style.display = 'none';
      this.orderFeedback?.clearFacingPreview?.();
      this.orderFeedback?.clearTargetHover?.();
      this.attackMoveQueued = false;
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    this.orderFeedback?.clearTargetHover?.();
    if (e.metaKey && e.button === 0) return;
    if ((e.button === 0 || e.button === 2) && this.input.isDown('Space')) {
      this.pointerDown = undefined;
      this.rightOrderStart = undefined;
      this.rightCameraLookCandidate = false;
      this.rightCameraLookActive = false;
      this.selectionBox.style.display = 'none';
      this.orderFeedback?.clearFacingPreview?.();
      e.preventDefault();
      this.dom.setPointerCapture?.(e.pointerId);
      return;
    }
    if (this.placement?.isPlacing()) {
      this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
      return;
    }
    if (this.tacticalPing?.isActive()) {
      const p = this.terrainPoint(e.clientX, e.clientY);
      if (e.button === 0 && p) this.tacticalPing.confirm(p.x, p.z);
      else if (e.button === 2) this.tacticalPing.cancel();
      e.preventDefault();
      return;
    }
    this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
    this.rightOrderStart = undefined;
    this.rightCameraLookCandidate = false;
    this.rightCameraLookActive = false;
    if (e.button === 2) {
      const hasSelectedMovers = selectedEntities(this.sim, this.localTeam).some((entity) => entity.mover);
      if (hasSelectedMovers) this.rightOrderStart = this.terrainPoint(e.clientX, e.clientY);
      else this.rightCameraLookCandidate = true;
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
      this.orderFeedback?.clearTargetHover?.();
      return;
    }
    if (!this.pointerDown) {
      this.updateTargetHover(e);
      return;
    }
    this.orderFeedback?.clearTargetHover?.();
    if (this.pointerDown.button === 2 && this.rightCameraLookCandidate) {
      const dx = e.clientX - this.pointerDown.x;
      const dy = e.clientY - this.pointerDown.y;
      if (Math.hypot(dx, dy) >= CAMERA_LOOK_DRAG_THRESHOLD) this.rightCameraLookActive = true;
      return;
    }
    if (this.pointerDown.button === 2 && this.rightOrderStart) {
      const dx = e.clientX - this.pointerDown.x;
      const dy = e.clientY - this.pointerDown.y;
      if (Math.hypot(dx, dy) < RIGHT_ORDER_DRAG_THRESHOLD) {
        this.orderFeedback?.clearFacingPreview?.();
        return;
      }
      const p = this.terrainPoint(e.clientX, e.clientY);
      if (p) {
        const movers = selectedEntities(this.sim, this.localTeam).filter((entity) => entity.mover);
        const dx = p.x - this.rightOrderStart.x;
        const dz = p.z - this.rightOrderStart.z;
        const distance = Math.hypot(dx, dz);
        const spread = formationSpreadForEntities(movers, distance);
        const scale = distance > 0.001 ? spread / distance : 1;
        this.orderFeedback?.showFacingPreview?.(
          this.rightOrderStart.x,
          this.rightOrderStart.z,
          this.rightOrderStart.x + dx * scale,
          this.rightOrderStart.z + dz * scale,
          this.isAttackMoveQueued() ? 'attack' : 'move',
          movers.length,
        );
      }
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
    this.orderFeedback?.clearTargetHover?.();

    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const pointerDistance = Math.hypot(dx, dy);
    const dragged = pointerDistance > (down.button === 2 ? RIGHT_ORDER_DRAG_THRESHOLD : LEFT_DRAG_THRESHOLD);
    if (down.button === 2 && this.rightCameraLookActive) {
      this.rightCameraLookCandidate = false;
      this.rightCameraLookActive = false;
      return;
    }
    this.rightCameraLookCandidate = false;
    this.rightCameraLookActive = false;
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
        setSelected(this.sim, hits, e.shiftKey, this.localTeam);
      } else {
        this.selectClick(e);
      }
    }

    if (down.button === 2) {
      const attackTarget = !dragged && this.selectedAttackers().length > 0 ? this.enemyTargetAt(e.clientX, e.clientY) : undefined;
      const selectedMovers = selectedEntities(this.sim, this.localTeam).filter((entity) => entity.mover);
      const destinationPoint = attackTarget
        ? attackStandoffPoint(this.sim, selectedMovers, attackTarget)
        : dragged
          ? this.rightOrderStart
          : this.terrainPoint(e.clientX, e.clientY) ?? this.terrainPoint(down.x, down.y);
      const facingPoint = dragged ? this.terrainPoint(e.clientX, e.clientY) : undefined;
      this.rightOrderStart = undefined;
      if (destinationPoint) {
        const rallyProducer = !dragged ? this.singleSelectedProducer() : undefined;
        if (rallyProducer && (this.commandSink?.rally?.(rallyProducer.id, destinationPoint.x, destinationPoint.z) ?? this.orderFeedback?.tryRally?.(destinationPoint.x, destinationPoint.z))) {
          this.attackMoveQueued = false;
          return;
        }
        const attackMove = this.isAttackMoveQueued() || attackTarget !== undefined;
        const selected = selectedMovers;
        const destination = destinationPoint;
        let faceYaw: number | undefined;
        let formationSpread: number | undefined;
        if (dragged && destination && facingPoint) {
          const faceDx = facingPoint.x - destination.x;
          const faceDz = facingPoint.z - destination.z;
          const faceDistance = Math.hypot(faceDx, faceDz);
          if (faceDistance > 2) {
            faceYaw = Math.atan2(faceDx, faceDz);
            formationSpread = formationSpreadForEntities(selected, faceDistance);
          }
        }
        if (selected.length > 0) {
          if (attackTarget) {
            const attackers = this.selectedAttackers();
            const attackerIds = attackers.map((entity) => entity.id);
            const attackIssued = this.commandSink?.attack?.(attackerIds, attackTarget.id) ?? issueAttackOrder(this.sim, attackers, attackTarget);
            if (attackIssued) this.orderFeedback?.showOrder(attackTarget.transform.x, attackTarget.transform.z, 'attack');
            this.attackMoveQueued = false;
            return;
          }
          const harvesters = !dragged ? selected.filter((entity) => entity.harvester) : [];
          const harvesterIds = harvesters.map((entity) => entity.id).filter((id): id is number => id !== undefined);
          const harvestIssued =
            harvesters.length > 0 &&
            (this.commandSink?.harvest?.(harvesterIds, destination.x, destination.z) ?? issueHarvestOrder(this.sim, harvesters, destination.x, destination.z));
          const returnIssued =
            !harvestIssued &&
            harvesters.length > 0 &&
            (this.commandSink?.returnHarvesters?.(harvesterIds, destination.x, destination.z) ?? issueHarvesterReturnOrder(this.sim, harvesters, destination.x, destination.z));
          const specialIssued = harvestIssued || returnIssued;
          const movers = specialIssued ? selected.filter((entity) => !entity.harvester) : selected;
          if (specialIssued) this.orderFeedback?.showOrder(destination.x, destination.z, 'move');
          const moverIds = movers.map((entity) => entity.id).filter((id): id is number => id !== undefined);
          if (
            movers.length > 0 &&
            (this.commandSink?.move?.(moverIds, destination.x, destination.z, attackMove, faceYaw, formationSpread) ??
              issueMoveOrder(this.sim, movers, destination.x, destination.z, attackMove, faceYaw, formationSpread))
          ) {
            this.orderFeedback?.showOrder(destination.x, destination.z, attackMove ? 'attack' : 'move');
            if (faceYaw !== undefined) {
              this.orderFeedback?.showFacingOrder?.(destination.x, destination.z, faceYaw, attackMove ? 'attack' : 'move', formationSpread, movers.length);
            }
          }
        }
        this.attackMoveQueued = false;
      }
    }
  }

  private selectClick(e: PointerEvent): void {
    const p = this.terrainPoint(e.clientX, e.clientY);
    const screenHit = this.units.pickAtScreen(this.camera, e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    const hit = screenHit ?? (p ? this.buildings?.pickAt(p.x, p.z) ?? this.units.pickAt(p.x, p.z) : undefined);
    if (!hit) {
      if (!e.shiftKey) setSelected(this.sim, [], false, this.localTeam);
      return;
    }
    const now = performance.now();
    if (this.lastClick.entity === hit && now - this.lastClick.time < 320 && hit.selectable) {
      setSelected(this.sim, this.units.visibleOfType(this.camera, hit.selectable.type, window.innerWidth, window.innerHeight), e.shiftKey, this.localTeam);
    } else {
      setSelected(this.sim, [hit], e.shiftKey, this.localTeam);
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
    if (e.code === 'Escape' && this.tacticalPing?.isActive()) {
      this.tacticalPing.cancel();
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyS' && selectedEntities(this.sim, this.localTeam).length > 0) {
      const selected = selectedEntities(this.sim, this.localTeam);
      const ids = selected.map((entity) => entity.id).filter((id): id is number => id !== undefined);
      if (!(this.commandSink?.stop?.(ids) ?? false)) stopEntities(selected);
      e.preventDefault();
    }
    if (e.code === 'KeyA' && selectedEntities(this.sim, this.localTeam).some((entity) => entity.weapon)) {
      this.attackMoveQueued = true;
      e.preventDefault();
      return;
    }
    if (!e.code.startsWith('Digit')) return;
    const n = Number(e.code.slice(5));
    if (n < 1 || n > 9) return;
    if (e.ctrlKey || e.metaKey) {
      this.controlGroups.set(n, selectedEntities(this.sim, this.localTeam));
      e.preventDefault();
    } else {
      const group = this.controlGroups.get(n);
      if (group) {
        setSelected(this.sim, group.filter((entity) => this.sim.world.has(entity)), false, this.localTeam);
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

  private updateTargetHover(e: PointerEvent): void {
    if (this.selectedAttackers().length === 0) {
      this.orderFeedback?.clearTargetHover?.();
      return;
    }
    const target = this.enemyTargetAt(e.clientX, e.clientY);
    if (target) this.orderFeedback?.showTargetHover?.(target);
    else this.orderFeedback?.clearTargetHover?.();
  }

  private enemyTargetAt(clientX: number, clientY: number): Entity | undefined {
    const p = this.terrainPoint(clientX, clientY);
    const screenHit = this.units.pickAtScreen(this.camera, clientX, clientY, window.innerWidth, window.innerHeight);
    const candidates = [
      screenHit,
      p ? this.buildings?.pickAt(p.x, p.z) : undefined,
      p ? this.units.pickAt(p.x, p.z) : undefined,
    ];
    return candidates.find((entity): entity is Entity => this.isEnemyTarget(entity));
  }

  private isEnemyTarget(entity: Entity | undefined): entity is Entity {
    if (!entity || entity.destroyed || !entity.health || !entity.team) return false;
    return areTeamsHostile(this.sim, this.localTeam, entity.team.id);
  }

  private selectedAttackers(): Entity[] {
    return selectedEntities(this.sim, this.localTeam).filter((entity) => entity.mover && (entity.weapon || entity.weapons));
  }

  private singleSelectedProducer(): Entity | undefined {
    const selected = selectedEntities(this.sim, this.localTeam);
    return selected.length === 1 && selected[0].producer ? selected[0] : undefined;
  }
}
