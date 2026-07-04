import {
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

export class OrderMarkerView {
  readonly group = new Group();
  private readonly markers: Marker[] = [];

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
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    const maybeMesh = child as Mesh;
    if (maybeMesh.geometry && maybeMesh.geometry !== ringGeometry && maybeMesh.geometry !== stemGeometry && maybeMesh.geometry !== coneGeometry) {
      maybeMesh.geometry.dispose();
    }
  });
}
