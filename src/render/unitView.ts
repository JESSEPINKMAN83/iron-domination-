import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  type Camera,
  type Material,
  type Scene,
  type Vector3,
} from 'three';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import type { RenderContext } from './renderer';

export class UnitView {
  readonly group = new Group();
  private readonly objects = new Map<Entity, Object3D>();
  private readonly selectedRings = new Map<Entity, Mesh>();
  private readonly entities: Entity[] = [];
  private readonly hullMaterial: Material;
  private readonly turretMaterial: Material;
  private readonly accentMaterial: Material;
  private readonly enemyAccentMaterial: Material;
  private readonly ringMaterial: Material;
  private readonly healthBackMaterial: Material;
  private readonly healthBars = new Map<Entity, { root: Group; fill: Mesh; fillMaterial: MeshBasicMaterial }>();

  constructor(entities: Entity[], private readonly hf: Heightfield, ctx: RenderContext) {
    this.hullMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x65787f, roughness: 0.78, metalness: 0.08 }));
    this.turretMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x3f535a, roughness: 0.82, metalness: 0.12 }));
    this.accentMaterial = ctx.setupLitMaterial(
      new MeshStandardMaterial({ color: 0xf0c85a, emissive: 0x2b1d00, roughness: 0.7, metalness: 0.1 }),
    );
    this.enemyAccentMaterial = ctx.setupLitMaterial(
      new MeshStandardMaterial({ color: 0xd65b46, emissive: 0x2a0600, roughness: 0.72, metalness: 0.08 }),
    );
    this.ringMaterial = new MeshBasicMaterial({ color: 0x7df27d, transparent: true, opacity: 0.72, depthWrite: false });
    this.healthBackMaterial = new MeshBasicMaterial({
      color: 0x050806,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: DoubleSide,
    });

    for (const entity of entities) this.addEntity(entity);
  }

  addEntity(entity: Entity): void {
    if (this.objects.has(entity)) return;
    this.entities.push(entity);
    const accent = entity.team?.id === 2 ? this.enemyAccentMaterial : this.accentMaterial;
    const unit =
      entity.selectable?.type === 'infantry'
        ? createInfantryObject(this.hullMaterial, accent)
        : createTankObject(this.hullMaterial, this.turretMaterial, accent);
    unit.castShadow = true;
    unit.traverse((obj) => {
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    this.objects.set(entity, unit);
    this.group.add(unit);

    const radius = entity.selectable?.type === 'infantry' ? 1.7 : 2.8;
    const ring = new Mesh(new RingGeometry(radius, radius + 0.35, 32), this.ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 30;
    this.selectedRings.set(entity, ring);
    this.group.add(ring);

    if (entity.health) {
      const healthBar = createHealthBar(this.healthBackMaterial);
      this.healthBars.set(entity, healthBar);
      this.group.add(healthBar.root);
    }
  }

  attach(scene: Scene): void {
    scene.add(this.group);
  }

  count(): number {
    return this.entities.length;
  }

  update(alpha: number, camera: Camera): void {
    for (const entity of this.entities) {
      const obj = this.objects.get(entity);
      const ring = this.selectedRings.get(entity);
      if (!obj || !ring) continue;
      if (entity.destroyed?.remaining !== undefined && entity.destroyed.remaining <= 0) {
        obj.visible = false;
        ring.visible = false;
        const healthBar = this.healthBars.get(entity);
        if (healthBar) healthBar.root.visible = false;
        continue;
      }
      const x = lerp(entity.previousTransform.x, entity.transform.x, alpha);
      const z = lerp(entity.previousTransform.z, entity.transform.z, alpha);
      const rot = lerpAngle(entity.previousTransform.rot, entity.transform.rot, alpha);
      const y = sampleHeight(this.hf, x, z) + 0.35;
      obj.position.set(x, y, z);
      obj.rotation.y = rot;
      obj.rotation.z = entity.destroyed ? 0.18 : 0;
      obj.scale.y = entity.destroyed ? 0.45 : 1;
      ring.position.set(x, sampleHeight(this.hf, x, z) + 0.08, z);
      ring.visible = !entity.destroyed && (entity.selectable?.selected ?? false);
      this.updateHealthBar(entity, x, y, z, camera);
    }
  }

  pickAt(x: number, z: number, maxRadius = 4.2): Entity | undefined {
    let best: Entity | undefined;
    let bestD2 = maxRadius * maxRadius;
    for (const entity of this.entities) {
      if (entity.destroyed) continue;
      const radius = entity.selectable?.radius ?? 2.4;
      const d2 = (entity.transform.x - x) ** 2 + (entity.transform.z - z) ** 2;
      if (d2 < Math.max(bestD2, radius * radius) && d2 < bestD2) {
        best = entity;
        bestD2 = d2;
      }
    }
    return best;
  }

  entitiesInScreenRect(camera: Camera, minX: number, minY: number, maxX: number, maxY: number, viewportW: number, viewportH: number): Entity[] {
    const out: Entity[] = [];
    for (const entity of this.entities) {
      if (entity.destroyed) continue;
      const p = projectEntity(entity, this.hf, camera);
      const sx = (p.x * 0.5 + 0.5) * viewportW;
      const sy = (-p.y * 0.5 + 0.5) * viewportH;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY && p.z >= -1 && p.z <= 1) out.push(entity);
    }
    return out;
  }

  visibleOfType(camera: Camera, type: string, viewportW: number, viewportH: number): Entity[] {
    const out: Entity[] = [];
    for (const entity of this.entities) {
      if (entity.destroyed) continue;
      if (entity.selectable?.type !== type) continue;
      const p = projectEntity(entity, this.hf, camera);
      const sx = (p.x * 0.5 + 0.5) * viewportW;
      const sy = (-p.y * 0.5 + 0.5) * viewportH;
      if (sx >= 0 && sx <= viewportW && sy >= 0 && sy <= viewportH && p.z >= -1 && p.z <= 1) out.push(entity);
    }
    return out;
  }

  private updateHealthBar(entity: Entity, x: number, y: number, z: number, camera: Camera): void {
    const healthBar = this.healthBars.get(entity);
    if (!healthBar || !entity.health) return;
    const pct = Math.max(0, Math.min(1, entity.health.current / entity.health.max));
    const selected = entity.selectable?.selected ?? false;
    healthBar.root.visible = !entity.destroyed && (selected || pct < 0.995);
    if (!healthBar.root.visible) return;
    healthBar.root.position.set(x, y + (entity.selectable?.type === 'infantry' ? 2.6 : 4.9), z);
    healthBar.root.lookAt(camera.position);
    healthBar.fill.scale.x = Math.max(0.02, pct);
    healthBar.fill.position.x = -1.8 * (1 - pct);
    healthBar.fillMaterial.color.setHex(pct < 0.3 ? 0xff5142 : pct < 0.62 ? 0xffc04a : 0x79f06f);
  }
}

function createHealthBar(backMaterial: Material): { root: Group; fill: Mesh; fillMaterial: MeshBasicMaterial } {
  const root = new Group();
  root.visible = false;

  const back = new Mesh(new PlaneGeometry(4.1, 0.48), backMaterial);
  back.renderOrder = 42;
  root.add(back);

  const fillMaterial = new MeshBasicMaterial({ color: 0x79f06f, transparent: true, opacity: 0.92, depthWrite: false, side: DoubleSide });
  const fill = new Mesh(new PlaneGeometry(3.6, 0.22), fillMaterial);
  fill.position.z = 0.02;
  fill.renderOrder = 43;
  root.add(fill);

  return { root, fill, fillMaterial };
}

function createTankObject(hullMaterial: Material, turretMaterial: Material, accentMaterial: Material): Group {
  const group = new Group();
  const hull = new Mesh(new BoxGeometry(3.6, 0.9, 5.0), hullMaterial);
  hull.position.y = 0.6;
  group.add(hull);

  const turret = new Mesh(new BoxGeometry(2.1, 0.65, 2.2), turretMaterial);
  turret.position.y = 1.25;
  group.add(turret);

  const barrel = new Mesh(new BoxGeometry(0.28, 0.28, 3.2), turretMaterial);
  barrel.position.set(0, 1.27, 2.65);
  group.add(barrel);

  const teamMark = new Mesh(new BoxGeometry(2.5, 0.05, 0.32), accentMaterial);
  teamMark.position.set(0, 1.73, -0.2);
  group.add(teamMark);

  const leftTrack = new Mesh(new BoxGeometry(0.62, 0.42, 5.4), hullMaterial);
  leftTrack.position.set(-2.02, 0.32, 0);
  group.add(leftTrack);
  const rightTrack = new Mesh(new BoxGeometry(0.62, 0.42, 5.4), hullMaterial);
  rightTrack.position.set(2.02, 0.32, 0);
  group.add(rightTrack);

  const hatch = new Mesh(new CylinderGeometry(0.45, 0.55, 0.2, 8), turretMaterial);
  hatch.position.set(0, 1.7, -0.35);
  group.add(hatch);
  return group;
}

function createInfantryObject(bodyMaterial: Material, accentMaterial: Material): Group {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(0.85, 1.4, 0.55), bodyMaterial);
  body.position.y = 0.9;
  group.add(body);
  const head = new Mesh(new BoxGeometry(0.55, 0.45, 0.55), bodyMaterial);
  head.position.y = 1.7;
  group.add(head);
  const rifle = new Mesh(new BoxGeometry(0.16, 0.16, 1.4), accentMaterial);
  rifle.position.set(0.25, 1.25, 0.55);
  group.add(rifle);
  return group;
}

function projectEntity(entity: Entity, hf: Heightfield, camera: Camera): Vector3 {
  const p = camera.position.clone();
  p.set(entity.transform.x, sampleHeight(hf, entity.transform.x, entity.transform.z) + 1.2, entity.transform.z);
  return p.project(camera);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
