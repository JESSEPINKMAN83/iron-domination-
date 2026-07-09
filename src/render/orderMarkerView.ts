import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Object3D,
} from 'three';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import type { Entity } from '../sim/components';

export type OrderMarkerKind = 'move' | 'attack' | 'rally';

interface Marker {
  root: Group;
  pin: Group;
  ring: Mesh;
  ttl: number;
  total: number;
  materials: MeshBasicMaterial[];
  baseOpacities: number[];
}

const ringGeometry = new RingGeometry(2.8, 3.55, 48);
const stemGeometry = new CylinderGeometry(0.08, 0.08, 2.2, 8);
const coneGeometry = new ConeGeometry(0.62, 1.25, 4);
const arrowShaftGeometry = new BoxGeometry(1, 0.18, 1);
const arrowHeadGeometry = new ConeGeometry(1.15, 2.25, 3);
const slotDiscGeometry = new CylinderGeometry(0.76, 0.76, 0.18, 24);
const slotRingGeometry = new RingGeometry(1.15, 1.55, 28);
const slotFacingGeometry = new BoxGeometry(0.28, 0.16, 1.65);
const targetRingGeometry = new RingGeometry(2.8, 3.5, 56);
const targetInnerRingGeometry = new RingGeometry(1.25, 1.45, 44);
const targetBracketGeometry = new BoxGeometry(1.8, 0.16, 0.32);
const MAX_FACING_ARROW_LENGTH = 72;
const MAX_FORMATION_PREVIEW_SLOTS = 48;
const FORMATION_SLOT_LIFT = 2.55;
const FORMATION_BASE_SPACING = 5.2;
const FORMATION_MIN_SPACING = FORMATION_BASE_SPACING * 0.75;
const FORMATION_MAX_SPACING = FORMATION_BASE_SPACING * 3.5;
const TARGET_HOVER_LIFT = 3.15;

interface FormationSlot {
  root: Group;
  disc: Mesh;
  ring: Mesh;
  facing: Mesh;
}

interface FacingPreview {
  root: Group;
  slots: FormationSlot[];
  anchorRing: Mesh;
  direction: Mesh;
  materials: MeshBasicMaterial[];
}

interface TargetHover {
  root: Group;
  ring: Mesh;
  innerRing: Mesh;
  brackets: Mesh[];
  materials: MeshBasicMaterial[];
  target?: Entity;
  radius: number;
  pulse: number;
}

export class OrderMarkerView {
  readonly group = new Group();
  private readonly markers: Marker[] = [];
  private preview?: FacingPreview;
  private targetHover?: TargetHover;

  constructor(private readonly hf: Heightfield) {}

  push(x: number, z: number, kind: OrderMarkerKind): void {
    const y = sampleHeight(this.hf, x, z);
    const color = kind === 'attack' ? 0xff543e : kind === 'rally' ? 0xf0d56a : 0x7df27d;
    const core = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    const ringMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: DoubleSide,
    });
    const dark = new MeshBasicMaterial({ color: 0x111a15, transparent: true, opacity: 0.72, depthWrite: false });

    const root = new Group();
    root.position.set(x, y, z);
    root.renderOrder = 75;

    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.renderOrder = 74;
    root.add(ring);

    const pin = new Group();
    pin.position.y = 1.35;
    const stem = new Mesh(stemGeometry, core);
    stem.position.y = 1.1;
    stem.renderOrder = 76;
    pin.add(stem);

    const cone = new Mesh(coneGeometry, core);
    cone.rotation.x = Math.PI;
    cone.position.y = 2.55;
    cone.rotation.y = Math.PI * 0.25;
    cone.renderOrder = 77;
    pin.add(cone);

    const shadow = new Mesh(new RingGeometry(0.75, 0.95, 24), dark);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.16;
    shadow.renderOrder = 73;
    root.add(shadow);

    root.add(pin);
    this.group.add(root);
    const materials = [core, ringMaterial, dark];
    this.markers.push({ root, pin, ring, ttl: 2.15, total: 2.15, materials, baseOpacities: materials.map((material) => material.opacity) });
    while (this.markers.length > 16) this.removeMarker(0);
  }

  pushFacing(x: number, z: number, yaw: number, kind: OrderMarkerKind, length?: number, count = 1): void {
    this.pushFormationSlots(x, z, yaw, kind, length ?? (kind === 'rally' ? 11 : 15), count, 1.8);
  }

  showFacingPreview(fromX: number, fromZ: number, toX: number, toZ: number, kind: OrderMarkerKind, count = 1): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const distance = Math.hypot(dx, dz);
    if (distance < 2.5) {
      this.clearFacingPreview();
      return;
    }
    if (!this.preview) this.preview = this.createPreview(kind);
    const y = sampleHeight(this.hf, fromX, fromZ);
    const yaw = Math.atan2(dx, dz);
    this.preview.root.visible = true;
    this.preview.root.position.set(fromX, y, fromZ);
    this.preview.anchorRing.position.set(0, FORMATION_SLOT_LIFT - 0.16, 0);
    this.preview.anchorRing.rotation.z += 0.08;
    this.preview.direction.position.set(Math.sin(yaw) * 2.2, FORMATION_SLOT_LIFT + 0.18, Math.cos(yaw) * 2.2);
    this.preview.direction.rotation.y = yaw;
    const color = kind === 'attack' ? 0xff543e : kind === 'rally' ? 0xf0d56a : 0x7df27d;
    this.preview.materials.forEach((material) => material.color.setHex(color));
    this.layoutFormationSlots(this.preview.slots, fromX, fromZ, yaw, distance, count, 1, true);
  }

  clearFacingPreview(): void {
    if (this.preview) this.preview.root.visible = false;
  }

  showTargetHover(target: Entity): void {
    if (!this.targetHover) this.targetHover = this.createTargetHover();
    const hover = this.targetHover;
    hover.target = target;
    hover.radius = targetHoverRadius(target, this.hf.cellSize);
    hover.root.visible = true;
    this.positionTargetHover(hover);
  }

  clearTargetHover(): void {
    if (!this.targetHover) return;
    this.targetHover.root.visible = false;
    this.targetHover.target = undefined;
  }

  update(dt: number): void {
    this.updateTargetHover(dt);
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const marker = this.markers[i];
      marker.ttl -= dt;
      const age = 1 - Math.max(0, marker.ttl) / marker.total;
      const fade = Math.min(1, Math.max(0, marker.ttl / 0.45));
      marker.ring.scale.setScalar(1 + age * 1.8);
      marker.pin.position.y = 1.35 + Math.sin(age * Math.PI * 5) * 0.2;
      marker.pin.scale.setScalar(1 + Math.sin(age * Math.PI * 4) * 0.08);
      marker.materials.forEach((material, materialIndex) => {
        material.opacity = marker.baseOpacities[materialIndex] * fade;
      });
      if (marker.ttl <= 0) this.removeMarker(i);
    }
  }

  private removeMarker(index: number): void {
    const marker = this.markers[index];
    this.group.remove(marker.root);
    disposeObject(marker.root);
    for (const material of marker.materials) material.dispose();
    this.markers.splice(index, 1);
  }

  private pushArrow(fromX: number, fromZ: number, toX: number, toZ: number, kind: OrderMarkerKind, ttl: number): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const distance = Math.hypot(dx, dz);
    if (distance < 2) return;
    const color = kind === 'attack' ? 0xff543e : kind === 'rally' ? 0xf0d56a : 0x7df27d;
    const core = new MeshBasicMaterial({ color, transparent: true, opacity: 0.78, depthWrite: false });
    const ringMaterial = new MeshBasicMaterial({ color, transparent: true, opacity: 0.48, depthWrite: false, side: DoubleSide });
    const dark = new MeshBasicMaterial({ color: 0x06110b, transparent: true, opacity: 0.62, depthWrite: false });
    const root = new Group();
    root.position.set(fromX, sampleHeight(this.hf, fromX, fromZ) + 0.22, fromZ);
    root.rotation.y = Math.atan2(dx, dz);
    root.renderOrder = 80;

    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    ring.renderOrder = 78;
    root.add(ring);

    const shaft = new Mesh(arrowShaftGeometry, core);
    shaft.scale.set(0.62, 1, Math.min(MAX_FACING_ARROW_LENGTH, Math.max(8, distance)));
    shaft.position.set(0, 0.2, shaft.scale.z / 2);
    shaft.renderOrder = 81;
    root.add(shaft);

    const head = new Mesh(arrowHeadGeometry, core);
    head.rotation.x = Math.PI / 2;
    head.rotation.y = Math.PI;
    head.position.set(0, 0.36, shaft.scale.z + 0.9);
    head.renderOrder = 82;
    root.add(head);

    const shadow = new Mesh(arrowShaftGeometry, dark);
    shadow.scale.set(0.84, 1, shaft.scale.z + 1.6);
    shadow.position.set(0, 0.05, shaft.scale.z / 2 + 0.35);
    shadow.renderOrder = 77;
    root.add(shadow);

    const pin = new Group();
    this.group.add(root);
    const materials = [core, ringMaterial, dark];
    this.markers.push({ root, pin, ring, ttl, total: ttl, materials, baseOpacities: materials.map((material) => material.opacity) });
    while (this.markers.length > 16) this.removeMarker(0);
  }

  private pushFormationSlots(x: number, z: number, yaw: number, kind: OrderMarkerKind, spread: number, count: number, ttl: number): void {
    const color = kind === 'attack' ? 0xff543e : kind === 'rally' ? 0xf0d56a : 0x7df27d;
    const core = new MeshBasicMaterial({ color, transparent: true, opacity: 0.82, depthWrite: false, depthTest: false });
    const ringMaterial = new MeshBasicMaterial({ color, transparent: true, opacity: 0.54, depthWrite: false, depthTest: false, side: DoubleSide });
    const dark = new MeshBasicMaterial({ color: 0x06110b, transparent: true, opacity: 0.46, depthWrite: false, depthTest: false });
    const root = new Group();
    root.position.set(x, sampleHeight(this.hf, x, z), z);
    root.renderOrder = 90;

    const anchorRing = new Mesh(new RingGeometry(3.1, 3.65, 36), ringMaterial);
    anchorRing.rotation.x = -Math.PI / 2;
    anchorRing.position.y = FORMATION_SLOT_LIFT - 0.2;
    anchorRing.renderOrder = 89;
    root.add(anchorRing);

    const direction = new Mesh(slotFacingGeometry, core);
    direction.position.set(Math.sin(yaw) * 2.25, FORMATION_SLOT_LIFT + 0.18, Math.cos(yaw) * 2.25);
    direction.rotation.y = yaw;
    direction.renderOrder = 92;
    root.add(direction);

    const slots = this.createFormationSlotMeshes(root, core, ringMaterial, dark, Math.max(1, Math.min(count, MAX_FORMATION_PREVIEW_SLOTS)));
    this.layoutFormationSlots(slots, x, z, yaw, spread, count, ttl, false);

    this.group.add(root);
    const pin = new Group();
    const materials = [core, ringMaterial, dark];
    this.markers.push({ root, pin, ring: anchorRing, ttl, total: ttl, materials, baseOpacities: materials.map((material) => material.opacity) });
    while (this.markers.length > 16) this.removeMarker(0);
  }

  private createPreview(kind: OrderMarkerKind): FacingPreview {
    const color = kind === 'attack' ? 0xff543e : kind === 'rally' ? 0xf0d56a : 0x7df27d;
    const core = new MeshBasicMaterial({ color, transparent: true, opacity: 0.82, depthWrite: false, depthTest: false });
    const ringMaterial = new MeshBasicMaterial({ color, transparent: true, opacity: 0.54, depthWrite: false, depthTest: false, side: DoubleSide });
    const dark = new MeshBasicMaterial({ color: 0x06110b, transparent: true, opacity: 0.46, depthWrite: false, depthTest: false });
    const root = new Group();
    root.visible = false;
    root.renderOrder = 90;
    const anchorRing = new Mesh(new RingGeometry(3.1, 3.65, 36), ringMaterial);
    anchorRing.rotation.x = -Math.PI / 2;
    anchorRing.rotation.z = Math.PI / 4;
    anchorRing.renderOrder = 88;
    root.add(anchorRing);
    const direction = new Mesh(slotFacingGeometry, core);
    direction.renderOrder = 92;
    root.add(direction);
    const slots = this.createFormationSlotMeshes(root, core, ringMaterial, dark, MAX_FORMATION_PREVIEW_SLOTS);
    this.group.add(root);
    return { root, slots, anchorRing, direction, materials: [core, ringMaterial, dark] };
  }

  private createTargetHover(): TargetHover {
    const core = new MeshBasicMaterial({ color: 0xff2f2f, transparent: true, opacity: 0.86, depthWrite: false, depthTest: false, side: DoubleSide });
    const soft = new MeshBasicMaterial({ color: 0xff5c4a, transparent: true, opacity: 0.34, depthWrite: false, depthTest: false, side: DoubleSide });
    const dark = new MeshBasicMaterial({ color: 0x130303, transparent: true, opacity: 0.42, depthWrite: false, depthTest: false, side: DoubleSide });
    const root = new Group();
    root.visible = false;
    root.renderOrder = 110;

    const shadow = new Mesh(targetRingGeometry, dark);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = TARGET_HOVER_LIFT - 0.08;
    shadow.renderOrder = 107;
    root.add(shadow);

    const ring = new Mesh(targetRingGeometry, core);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = TARGET_HOVER_LIFT;
    ring.renderOrder = 112;
    root.add(ring);

    const innerRing = new Mesh(targetInnerRingGeometry, soft);
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = TARGET_HOVER_LIFT + 0.08;
    innerRing.renderOrder = 111;
    root.add(innerRing);

    const brackets: Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const bracket = new Mesh(targetBracketGeometry, core);
      bracket.position.y = TARGET_HOVER_LIFT + 0.18;
      bracket.renderOrder = 113;
      root.add(bracket);
      brackets.push(bracket);
    }

    this.group.add(root);
    return { root, ring, innerRing, brackets, materials: [core, soft, dark], radius: 4, pulse: 0 };
  }

  private updateTargetHover(dt: number): void {
    const hover = this.targetHover;
    if (!hover || !hover.root.visible) return;
    if (!hover.target || hover.target.destroyed || (hover.target.health && hover.target.health.current <= 0)) {
      this.clearTargetHover();
      return;
    }
    hover.radius = targetHoverRadius(hover.target, this.hf.cellSize);
    hover.pulse += dt;
    this.positionTargetHover(hover);
    const pulse = 0.5 + 0.5 * Math.sin(hover.pulse * 7.5);
    const breathe = 1 + pulse * 0.045;
    hover.ring.scale.setScalar((hover.radius / 3.15) * breathe);
    hover.innerRing.scale.setScalar((hover.radius / 2.2) * (1 + pulse * 0.03));
    hover.ring.rotation.z += dt * 1.15;
    hover.innerRing.rotation.z -= dt * 0.72;
    hover.materials[0].opacity = 0.72 + pulse * 0.18;
    hover.materials[1].opacity = 0.22 + pulse * 0.16;
    hover.materials[2].opacity = 0.32 + pulse * 0.12;
  }

  private positionTargetHover(hover: TargetHover): void {
    const target = hover.target;
    if (!target) return;
    const x = target.transform.x;
    const z = target.transform.z;
    hover.root.position.set(x, sampleHeight(this.hf, x, z), z);
    const radius = hover.radius;
    for (let i = 0; i < hover.brackets.length; i++) {
      const bracket = hover.brackets[i];
      const angle = i * (Math.PI / 2);
      bracket.position.x = Math.sin(angle) * radius;
      bracket.position.z = Math.cos(angle) * radius;
      bracket.rotation.y = angle;
      bracket.scale.set(1 + radius * 0.04, 1, 1);
    }
  }

  private createFormationSlotMeshes(
    root: Group,
    discMaterial: MeshBasicMaterial,
    ringMaterial: MeshBasicMaterial,
    darkMaterial: MeshBasicMaterial,
    count: number,
  ): FormationSlot[] {
    const slots: FormationSlot[] = [];
    for (let i = 0; i < count; i++) {
      const slotRoot = new Group();
      slotRoot.visible = false;
      slotRoot.renderOrder = 94;
      const shadow = new Mesh(slotDiscGeometry, darkMaterial);
      shadow.scale.set(1.35, 0.4, 1.35);
      shadow.position.y = -0.08;
      shadow.renderOrder = 93;
      const disc = new Mesh(slotDiscGeometry, discMaterial);
      disc.renderOrder = 95;
      const ring = new Mesh(slotRingGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.13;
      ring.renderOrder = 96;
      const facing = new Mesh(slotFacingGeometry, discMaterial);
      facing.position.z = 1.05;
      facing.position.y = 0.24;
      facing.renderOrder = 97;
      slotRoot.add(shadow, disc, ring, facing);
      root.add(slotRoot);
      slots.push({ root: slotRoot, disc, ring, facing });
    }
    return slots;
  }

  private layoutFormationSlots(
    slots: FormationSlot[],
    originX: number,
    originZ: number,
    yaw: number,
    spread: number,
    count: number,
    ttlOrAlpha: number,
    preview: boolean,
  ): void {
    const actualCount = Math.max(1, count);
    const visibleCount = Math.min(slots.length, actualCount, MAX_FORMATION_PREVIEW_SLOTS);
    const spacing = formationSlotSpacing(spread, actualCount);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const pulse = preview ? 0.5 + 0.5 * Math.sin(performance.now() * 0.01) : 0.35;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const visible = i < visibleCount;
      slot.root.visible = visible;
      if (!visible) continue;
      const sourceIndex = visibleCount <= 1 ? 0 : Math.round((i * (actualCount - 1)) / Math.max(1, visibleCount - 1));
      const localX = (sourceIndex - (actualCount - 1) / 2) * spacing;
      const worldX = originX + rightX * localX;
      const worldZ = originZ + rightZ * localX;
      const groundDelta = sampleHeight(this.hf, worldX, worldZ) - sampleHeight(this.hf, originX, originZ);
      slot.root.position.set(rightX * localX, groundDelta + FORMATION_SLOT_LIFT, rightZ * localX);
      slot.root.rotation.y = yaw;
      slot.root.scale.setScalar(1 + pulse * 0.1);
      slot.ring.rotation.z += preview ? 0.06 + i * 0.0008 : 0.02;
      const fadeScale = preview ? 1 : Math.max(0.2, ttlOrAlpha);
      slot.disc.scale.set(1, 1, 1);
      slot.facing.scale.set(1, 1, 0.75 + pulse * 0.28 * fadeScale);
    }
  }
}

function formationSlotSpacing(spread: number, count: number): number {
  if (count <= 1) return FORMATION_BASE_SPACING;
  return Math.max(FORMATION_MIN_SPACING, Math.min(FORMATION_MAX_SPACING, spread / Math.max(1, count - 1)));
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    const maybeMesh = child as Mesh;
    if (
      maybeMesh.geometry &&
      maybeMesh.geometry !== ringGeometry &&
      maybeMesh.geometry !== stemGeometry &&
      maybeMesh.geometry !== coneGeometry &&
      maybeMesh.geometry !== arrowShaftGeometry &&
      maybeMesh.geometry !== arrowHeadGeometry &&
      maybeMesh.geometry !== slotDiscGeometry &&
      maybeMesh.geometry !== slotRingGeometry &&
      maybeMesh.geometry !== slotFacingGeometry &&
      maybeMesh.geometry !== targetRingGeometry &&
      maybeMesh.geometry !== targetInnerRingGeometry &&
      maybeMesh.geometry !== targetBracketGeometry
    ) {
      maybeMesh.geometry.dispose();
    }
  });
}

function targetHoverRadius(target: Entity, cellSize: number): number {
  const selectableRadius = target.selectable?.radius ?? 0;
  const colliderRadius = target.collider?.radius ?? 0;
  const footprintRadius = target.building ? Math.hypot(target.building.footprint.w * cellSize, target.building.footprint.h * cellSize) * 0.72 : 0;
  return Math.max(3.8, selectableRadius * 1.65, colliderRadius * 1.45, footprintRadius);
}
