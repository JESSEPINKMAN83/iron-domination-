import {
  BoxGeometry,
  CircleGeometry,
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
import { buildSoldier, type SoldierMaterials, type SoldierRig } from './soldier';

interface AnimState {
  phase: number; // walk-cycle phase, radians
  swing: number; // 0..1 blend between idle and walking pose
}

export class UnitView {
  readonly group = new Group();
  private readonly objects = new Map<Entity, Object3D>();
  private readonly selectedRings = new Map<Entity, Mesh>();
  private readonly entities: Entity[] = [];
  private readonly hullMaterial: Material;
  private readonly turretMaterial: Material;
  private readonly accentMaterial: Material;
  private readonly enemyAccentMaterial: Material;
  private readonly wreckMaterial: Material;
  private readonly ringMaterial: Material;
  private readonly healthBackMaterial: Material;
  private readonly soldierMaterials: Omit<SoldierMaterials, 'accent'>;
  private readonly healthBars = new Map<Entity, { root: Group; fill: Mesh; fillMaterial: MeshBasicMaterial }>();
  private readonly soldierRigs = new Map<Entity, SoldierRig>();
  private readonly anims = new Map<Entity, AnimState>();
  private readonly airShadows = new Map<Entity, Mesh>();
  private readonly airShadowMaterial = new MeshBasicMaterial({ color: 0x020403, transparent: true, opacity: 0.26, depthWrite: false });
  private readonly wrecked = new Set<Entity>();
  private hiddenEntity?: Entity;
  private selectionOverlayVisible = true;

  constructor(
    entities: Entity[],
    private readonly hf: Heightfield,
    ctx: RenderContext,
    private readonly isVisible: (x: number, z: number) => boolean = () => true,
  ) {
    this.hullMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x65787f, roughness: 0.78, metalness: 0.08 }));
    this.turretMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x3f535a, roughness: 0.82, metalness: 0.12 }));
    this.accentMaterial = ctx.setupLitMaterial(
      new MeshStandardMaterial({ color: 0xf0c85a, emissive: 0x2b1d00, roughness: 0.7, metalness: 0.1 }),
    );
    this.enemyAccentMaterial = ctx.setupLitMaterial(
      new MeshStandardMaterial({ color: 0xd65b46, emissive: 0x2a0600, roughness: 0.72, metalness: 0.08 }),
    );
    this.wreckMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x1d1a16, roughness: 1, metalness: 0.05 }));
    this.soldierMaterials = {
      uniform: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x55603f, roughness: 0.9, metalness: 0.02 })),
      gear: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x33392c, roughness: 0.92, metalness: 0.04 })),
      skin: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0xb98a63, roughness: 0.85, metalness: 0 })),
      gunmetal: ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x23262a, roughness: 0.55, metalness: 0.45 })),
    };
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
    let unit: Object3D;
    if (entity.selectable?.type === 'infantry') {
      const rig = buildSoldier({ ...this.soldierMaterials, accent });
      this.soldierRigs.set(entity, rig);
      this.anims.set(entity, { phase: 0, swing: 0 });
      unit = rig.root;
    } else if (entity.selectable?.type === 'vulture') {
      unit = createVultureObject(this.hullMaterial, this.turretMaterial, accent);
      const shadow = new Mesh(new CircleGeometry(3.8, 32), this.airShadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 18;
      this.airShadows.set(entity, shadow);
      this.group.add(shadow);
    } else {
      unit = createTankObject(this.hullMaterial, this.turretMaterial, accent);
    }
    const scale = visualScaleForEntity(entity);
    unit.scale.set(scale.x, scale.y, scale.z);
    unit.castShadow = true;
    unit.traverse((obj) => {
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    this.objects.set(entity, unit);
    this.group.add(unit);

    const radius = entity.selectable?.type === 'infantry' ? 1.7 : entity.selectable?.type === 'vulture' ? 3.9 : 2.8;
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

  setHiddenEntity(entity?: Entity): void {
    this.hiddenEntity = entity;
  }

  setSelectionOverlayVisible(visible: boolean): void {
    this.selectionOverlayVisible = visible;
  }

  update(alpha: number, dt: number, camera: Camera): void {
    for (const entity of this.entities) {
      const obj = this.objects.get(entity);
      const ring = this.selectedRings.get(entity);
      if (!obj || !ring) continue;
      const gone = entity === this.hiddenEntity || (entity.destroyed?.remaining !== undefined && entity.destroyed.remaining <= 0);
      const fogged = entity.team?.id !== 1 && !this.isVisible(entity.transform.x, entity.transform.z);
      if (gone || fogged) {
        obj.visible = false;
        ring.visible = false;
        const shadow = this.airShadows.get(entity);
        if (shadow) shadow.visible = false;
        const healthBar = this.healthBars.get(entity);
        if (healthBar) healthBar.root.visible = false;
        continue;
      }
      obj.visible = true;
      const x = lerp(entity.previousTransform.x, entity.transform.x, alpha);
      const z = lerp(entity.previousTransform.z, entity.transform.z, alpha);
      const rot = lerpAngle(entity.previousTransform.rot, entity.transform.rot, alpha);
      const groundY = sampleHeight(this.hf, x, z);
      const y = entity.flight ? lerp(entity.previousTransform.y ?? entity.transform.y ?? groundY, entity.transform.y ?? groundY, alpha) : groundY + 0.35;
      obj.position.set(x, y, z);
      obj.rotation.y = rot;
      this.applyPose(entity, obj, dt);
      const turret = obj.getObjectByName('turretPivot');
      if (turret && entity.turret && !entity.destroyed) turret.rotation.y = entity.turret.yaw - rot;
      ring.position.set(x, groundY + 0.08, z);
      ring.visible = this.selectionOverlayVisible && !entity.destroyed && (entity.selectable?.selected ?? false);
      const shadow = this.airShadows.get(entity);
      if (shadow) {
        const agl = Math.max(0, y - groundY);
        shadow.visible = !entity.destroyed;
        shadow.position.set(x, groundY + 0.09, z);
        shadow.scale.setScalar(Math.max(0.55, 1 + agl / 62));
      }
      this.updateHealthBar(entity, x, y, z, camera);
    }
  }

  /** Walk cycles, death poses, and wreck states — all driven by sim data. */
  private applyPose(entity: Entity, obj: Object3D, dt: number): void {
    const isInfantry = entity.selectable?.type === 'infantry';
    if (entity.destroyed) {
      const sinceDeath = Math.max(0, 20 - entity.destroyed.remaining);
      const fall = Math.min(1, sinceDeath / 0.45);
      if (isInfantry) {
        // soldiers crumple sideways
        obj.rotation.z = fall * (Math.PI / 2) * 0.96;
        obj.position.y += 0.12 - fall * 0.18;
        obj.scale.setScalar(1);
      } else if (!this.wrecked.has(entity)) {
        // tanks become scorched husks that persist
        this.wrecked.add(entity);
        obj.traverse((child) => {
          if (child instanceof Mesh) child.material = this.wreckMaterial;
        });
        obj.rotation.z = 0.09;
        const turret = obj.getObjectByName('turretPivot');
        if (turret) {
          turret.rotation.x = 0.14;
          turret.position.y = -0.12;
        }
      }
      return;
    }

    if (entity.flight) {
      obj.rotation.z = -(entity.flight.bank ?? 0);
      const mainRotor = obj.getObjectByName('mainRotor');
      const tailRotor = obj.getObjectByName('tailRotor');
      const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
      if (mainRotor) mainRotor.rotation.y += dt * (18 + speed * 1.7);
      if (tailRotor) tailRotor.rotation.x += dt * (24 + speed * 2.2);
      if (!entity.destroyed) obj.position.y += Math.sin(performance.now() * 0.004 + entity.id) * 0.035;
      return;
    }

    if (!isInfantry) return;
    const rig = this.soldierRigs.get(entity);
    const anim = this.anims.get(entity);
    if (!rig || !anim) return;
    const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
    const moving = speed > 0.4;
    anim.swing += ((moving ? 1 : 0) - anim.swing) * Math.min(1, dt * 8);
    if (moving) anim.phase += dt * (3.2 + speed * 0.62);

    const s = Math.sin(anim.phase);
    const c = Math.sin(anim.phase + Math.PI);
    rig.hipL.rotation.x = s * 0.62 * anim.swing;
    rig.hipR.rotation.x = c * 0.62 * anim.swing;
    // knee bends as the leg swings back and lifts
    rig.kneeL.rotation.x = Math.max(0, -s) * 0.85 * anim.swing;
    rig.kneeR.rotation.x = Math.max(0, -c) * 0.85 * anim.swing;
    // gait bob + a touch of forward lean when running
    rig.root.position.y += (Math.abs(Math.sin(anim.phase * 2)) * 0.05 - 0.02) * anim.swing;
    rig.root.rotation.x = 0.08 * anim.swing;
    // idle breathing
    rig.torso.position.y = 1.1 + Math.sin(anim.phase * 0.35 + entity.id) * 0.008 * (1 - anim.swing);
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
    healthBar.root.visible = !entity.destroyed && ((this.selectionOverlayVisible && selected) || pct < 0.995);
    if (!healthBar.root.visible) return;
    healthBar.root.position.set(x, y + (entity.selectable?.type === 'infantry' ? 2.6 : entity.selectable?.type === 'vulture' ? 3.2 : 4.9), z);
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

  const turretPivot = new Group();
  turretPivot.name = 'turretPivot';
  group.add(turretPivot);

  const turret = new Mesh(new BoxGeometry(2.1, 0.65, 2.2), turretMaterial);
  turret.position.y = 1.25;
  turretPivot.add(turret);

  const barrel = new Mesh(new BoxGeometry(0.28, 0.28, 3.2), turretMaterial);
  barrel.position.set(0, 1.27, 2.65);
  turretPivot.add(barrel);

  const teamMark = new Mesh(new BoxGeometry(2.5, 0.05, 0.32), accentMaterial);
  teamMark.position.set(0, 1.73, -0.2);
  turretPivot.add(teamMark);

  const leftTrack = new Mesh(new BoxGeometry(0.62, 0.42, 5.4), hullMaterial);
  leftTrack.position.set(-2.02, 0.32, 0);
  group.add(leftTrack);
  const rightTrack = new Mesh(new BoxGeometry(0.62, 0.42, 5.4), hullMaterial);
  rightTrack.position.set(2.02, 0.32, 0);
  group.add(rightTrack);

  const hatch = new Mesh(new CylinderGeometry(0.45, 0.55, 0.2, 8), turretMaterial);
  hatch.position.set(0, 1.7, -0.35);
  turretPivot.add(hatch);
  return group;
}

function createVultureObject(hullMaterial: Material, rotorMaterial: Material, accentMaterial: Material): Group {
  const group = new Group();

  const fuselage = new Mesh(new BoxGeometry(2.2, 1.0, 5.2), hullMaterial);
  fuselage.position.y = 0.25;
  group.add(fuselage);

  const nose = new Mesh(new BoxGeometry(1.35, 0.72, 1.45), accentMaterial);
  nose.position.set(0, 0.28, 2.55);
  group.add(nose);

  const tail = new Mesh(new BoxGeometry(0.55, 0.45, 4.2), hullMaterial);
  tail.position.set(0, 0.32, -4.2);
  group.add(tail);

  const leftSkid = new Mesh(new BoxGeometry(0.18, 0.16, 4.2), rotorMaterial);
  leftSkid.position.set(-1.35, -0.65, 0.15);
  group.add(leftSkid);
  const rightSkid = new Mesh(new BoxGeometry(0.18, 0.16, 4.2), rotorMaterial);
  rightSkid.position.set(1.35, -0.65, 0.15);
  group.add(rightSkid);
  const skidBarA = new Mesh(new BoxGeometry(2.9, 0.12, 0.16), rotorMaterial);
  skidBarA.position.set(0, -0.55, 1.5);
  group.add(skidBarA);
  const skidBarB = new Mesh(new BoxGeometry(2.9, 0.12, 0.16), rotorMaterial);
  skidBarB.position.set(0, -0.55, -1.45);
  group.add(skidBarB);

  const mast = new Mesh(new CylinderGeometry(0.11, 0.13, 0.72, 10), rotorMaterial);
  mast.position.y = 1.05;
  group.add(mast);
  const mainRotor = new Group();
  mainRotor.name = 'mainRotor';
  mainRotor.position.y = 1.48;
  const bladeA = new Mesh(new BoxGeometry(8.0, 0.045, 0.26), rotorMaterial);
  const bladeB = new Mesh(new BoxGeometry(0.26, 0.045, 8.0), rotorMaterial);
  mainRotor.add(bladeA, bladeB);
  group.add(mainRotor);

  const tailRotor = new Group();
  tailRotor.name = 'tailRotor';
  tailRotor.position.set(0, 0.5, -6.35);
  const tailBladeA = new Mesh(new BoxGeometry(0.09, 1.45, 0.12), rotorMaterial);
  const tailBladeB = new Mesh(new BoxGeometry(1.45, 0.09, 0.12), rotorMaterial);
  tailRotor.add(tailBladeA, tailBladeB);
  group.add(tailRotor);

  const podL = new Mesh(new BoxGeometry(0.36, 0.36, 1.6), rotorMaterial);
  podL.position.set(-1.42, 0.05, 1.25);
  group.add(podL);
  const podR = new Mesh(new BoxGeometry(0.36, 0.36, 1.6), rotorMaterial);
  podR.position.set(1.42, 0.05, 1.25);
  group.add(podR);
  return group;
}

function visualScaleForEntity(entity: Entity): { x: number; y: number; z: number } {
  const name = entity.name ?? '';
  if (name.includes('Jackal')) return { x: 0.82, y: 0.82, z: 0.88 };
  if (name.includes('Mauler')) return { x: 1.16, y: 1.1, z: 1.22 };
  if (name.includes('Wasp')) return { x: 0.78, y: 0.72, z: 0.82 };
  if (name.includes('Hammerhead')) return { x: 1.22, y: 1.12, z: 1.28 };
  return { x: 1, y: 1, z: 1 };
}

function projectEntity(entity: Entity, hf: Heightfield, camera: Camera): Vector3 {
  const p = camera.position.clone();
  const y = entity.flight ? entity.transform.y ?? sampleHeight(hf, entity.transform.x, entity.transform.z) + 28 : sampleHeight(hf, entity.transform.x, entity.transform.z) + 1.2;
  p.set(entity.transform.x, y, entity.transform.z);
  return p.project(camera);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
