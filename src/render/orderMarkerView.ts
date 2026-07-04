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

export class OrderMarkerView {
  readonly group = new Group();
  private readonly markers: Marker[] = [];
  private preview?: { root: Group; shaft: Mesh; head: Mesh; ring: Mesh; materials: MeshBasicMaterial[] };

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

  pushFacing(x: number, z: number, yaw: number, kind: OrderMarkerKind): void {
    const length = kind === 'rally' ? 11 : 15;
    const endX = x + Math.sin(yaw) * length;
    const endZ = z + Math.cos(yaw) * length;
    this.pushArrow(x, z, endX, endZ, kind, 1.8);
  }

  showFacingPreview(fromX: number, fromZ: number, toX: number, toZ: number, kind: OrderMarkerKind): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const distance = Math.hypot(dx, dz);
    if (distance < 2.5) {
      this.clearFacingPreview();
      return;
    }
    if (!this.preview) this.preview = this.createPreview(kind);
    const y = sampleHeight(this.hf, fromX, fromZ) + 0.22;
    const length = Math.min(42, Math.max(8, distance));
    const yaw = Math.atan2(dx, dz);
    this.preview.root.visible = true;
    this.preview.root.position.set(fromX, y, fromZ);
    this.preview.root.rotation.y = yaw;
    this.preview.shaft.scale.set(0.72, 1, length);
    this.preview.shaft.position.set(0, 0.18, length / 2);
    this.preview.head.position.set(0, 0.34, length + 0.9);
    this.preview.ring.rotation.z += 0.08;
    const color = kind === 'attack' ? 0xff543e : kind === 'rally' ? 0xf0d56a : 0x7df27d;
    this.preview.materials.forEach((material) => material.color.setHex(color));
  }

  clearFacingPreview(): void {
    if (this.preview) this.preview.root.visible = false;
  }

  update(dt: number): void {
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
    shaft.scale.set(0.62, 1, Math.min(42, Math.max(8, distance)));
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

  private createPreview(kind: OrderMarkerKind): { root: Group; shaft: Mesh; head: Mesh; ring: Mesh; materials: MeshBasicMaterial[] } {
    const color = kind === 'attack' ? 0xff543e : kind === 'rally' ? 0xf0d56a : 0x7df27d;
    const core = new MeshBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false });
    const ringMaterial = new MeshBasicMaterial({ color, transparent: true, opacity: 0.46, depthWrite: false, side: DoubleSide });
    const root = new Group();
    root.visible = false;
    root.renderOrder = 90;
    const ring = new Mesh(new RingGeometry(4.4, 4.95, 4), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = Math.PI / 4;
    ring.position.y = 0.08;
    ring.renderOrder = 88;
    root.add(ring);
    const shaft = new Mesh(arrowShaftGeometry, core);
    shaft.renderOrder = 91;
    root.add(shaft);
    const head = new Mesh(arrowHeadGeometry, core);
    head.rotation.x = Math.PI / 2;
    head.rotation.y = Math.PI;
    head.renderOrder = 92;
    root.add(head);
    this.group.add(root);
    return { root, shaft, head, ring, materials: [core, ringMaterial] };
  }
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
      maybeMesh.geometry !== arrowHeadGeometry
    ) {
      maybeMesh.geometry.dispose();
    }
  });
}
