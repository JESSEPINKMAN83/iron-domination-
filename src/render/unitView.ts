import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
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
  RepeatWrapping,
  SRGBColorSpace,
  type Camera,
  type BufferGeometry,
  type Material,
  type Scene,
  type Vector3,
} from 'three';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { factionId, FACTION, type FactionId } from './palette';
import type { RenderContext } from './renderer';
import { buildSoldier, type SoldierMaterials, type SoldierRig } from './soldier';
import { unitVisualKind, type UnitVisualKind } from './unitKinds';

interface AnimState {
  phase: number; // walk-cycle phase, radians
  swing: number; // 0..1 blend between idle and walking pose
  aim: number;
  crouch: number;
  recoil: number;
  lastCooldown: number;
}

interface TeamMaterials {
  hull: Material;
  dark: Material;
  canvas: Material;
  uniform: Material;
  accent: Material;
  lightBar: Material;
}

interface UnitRefs {
  turretPivot?: Object3D;
  barrelPivot?: Object3D;
  mainRotors?: Object3D[];
  tailRotors?: Object3D[];
  cargoLoad?: Object3D;
  scoop?: Object3D;
  warningBeacon?: Mesh;
  antenna?: Object3D;
  missileRack?: Object3D[];
}

interface BuiltUnit {
  root: Object3D;
  refs: UnitRefs;
}

interface UnitDamagePatch {
  mesh: Mesh;
  threshold: number;
  kind: 'scorch' | 'crack' | 'ember';
}

interface UnitDamageOverlay {
  root: Group;
  patches: UnitDamagePatch[];
}

// Unit and overlay geometries are shared by dimensions, so spawning visual variants
// does not allocate fresh GPU shapes for every entity.
const HEALTH_BACK_GEOM = new PlaneGeometry(4.1, 0.48);
const HEALTH_FILL_GEOM = new PlaneGeometry(3.6, 0.22);
const AIR_SHADOW_GEOM = new CircleGeometry(3.8, 32);
const ROTOR_WASH_GEOM = new RingGeometry(1.8, 5.2, 48);
const sharedGeometryTag = 'ironDominionSharedUnitGeometry';
const boxGeometryCache = new Map<string, BoxGeometry>();
const cylinderGeometryCache = new Map<string, CylinderGeometry>();
const ringGeometryCache = new Map<number, RingGeometry>();

function markShared<T extends BufferGeometry>(geom: T): T {
  geom.userData[sharedGeometryTag] = true;
  return geom;
}

function isSharedUnitGeometry(geom: BufferGeometry): boolean {
  return geom.userData[sharedGeometryTag] === true;
}

function sharedBoxGeometry(x: number, y: number, z: number): BoxGeometry {
  const key = `${x}:${y}:${z}`;
  let geom = boxGeometryCache.get(key);
  if (!geom) {
    geom = markShared(new BoxGeometry(x, y, z));
    boxGeometryCache.set(key, geom);
  }
  return geom;
}

function sharedCylinderGeometry(radiusTop: number, radiusBottom: number, height: number, radialSegments: number): CylinderGeometry {
  const key = `${radiusTop}:${radiusBottom}:${height}:${radialSegments}`;
  let geom = cylinderGeometryCache.get(key);
  if (!geom) {
    geom = markShared(new CylinderGeometry(radiusTop, radiusBottom, height, radialSegments));
    cylinderGeometryCache.set(key, geom);
  }
  return geom;
}

function sharedRingGeometry(radius: number): RingGeometry {
  let geom = ringGeometryCache.get(radius);
  if (!geom) {
    geom = markShared(new RingGeometry(radius, radius + 0.6, 48));
    ringGeometryCache.set(radius, geom);
  }
  return geom;
}

export class UnitView {
  readonly group = new Group();
  private readonly objects = new Map<Entity, Object3D>();
  private readonly refs = new Map<Entity, UnitRefs>();
  private readonly selectedRings = new Map<Entity, Mesh>();
  private readonly entities: Entity[] = [];
  private readonly teamMaterials: Record<FactionId, TeamMaterials>;
  private readonly wreckMaterial: Material;
  private readonly vehicleScorchMaterial: Material;
  private readonly vehicleCrackMaterial: Material;
  private readonly vehicleEmberMaterial: Material;
  private readonly ringMaterial: Material;
  private readonly healthBackMaterial: Material;
  private readonly skinMaterial: Material;
  private readonly gunmetalMaterial: Material;
  private readonly visorMaterial: Material;
  private readonly muzzleMaterial: MeshBasicMaterial;
  private readonly healthBars = new Map<Entity, { root: Group; fill: Mesh; fillMaterial: MeshBasicMaterial }>();
  private readonly soldierRigs = new Map<Entity, SoldierRig>();
  private readonly anims = new Map<Entity, AnimState>();
  private readonly airShadows = new Map<Entity, Mesh>();
  private readonly rotorWashes = new Map<Entity, { mesh: Mesh; material: MeshBasicMaterial }>();
  private readonly damageOverlays = new Map<Entity, UnitDamageOverlay>();
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
    this.teamMaterials = {
      1: createTeamMaterials(ctx, 1),
      2: createTeamMaterials(ctx, 2),
      3: createTeamMaterials(ctx, 3),
      4: createTeamMaterials(ctx, 4),
    };
    this.wreckMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x1d1a16, roughness: 1, metalness: 0.05 }));
    this.vehicleScorchMaterial = new MeshBasicMaterial({ color: 0x070605, transparent: true, opacity: 0.64, depthWrite: false, side: DoubleSide });
    this.vehicleCrackMaterial = new MeshBasicMaterial({ color: 0x0b0a09, transparent: true, opacity: 0.86, depthWrite: false, side: DoubleSide });
    this.vehicleEmberMaterial = new MeshBasicMaterial({
      color: 0xff5a1f,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    this.skinMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0xb98a63, roughness: 0.85, metalness: 0 }));
    this.gunmetalMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x23262a, roughness: 0.55, metalness: 0.45 }));
    this.visorMaterial = ctx.setupLitMaterial(new MeshStandardMaterial({ color: 0x101818, roughness: 0.24, metalness: 0.05 }));
    this.muzzleMaterial = new MeshBasicMaterial({
      color: 0xffd36a,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.ringMaterial = new MeshBasicMaterial({ color: 0xf0d56a, transparent: true, opacity: 0.94, depthWrite: false, depthTest: false });
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
    const kind = unitVisualKind(entity);
    const materials = this.teamMaterials[factionId(entity.team?.id)];
    let built: BuiltUnit;
    if (kind === 'rifle' || kind === 'grenadier' || kind === 'rocket' || kind === 'sniper') {
      const rig = buildSoldier(this.soldierMaterials(materials), kind);
      this.soldierRigs.set(entity, rig);
      this.anims.set(entity, { phase: 0, swing: 0, aim: 0, crouch: 0, recoil: 0, lastCooldown: entity.weapon?.cooldown ?? entity.weapons?.primary.cooldown ?? 0 });
      built = { root: rig.root, refs: { turretPivot: rig.torso, antenna: rig.antenna } };
    } else if (kind === 'wasp' || kind === 'vulture' || kind === 'hammerhead') {
      built = createAircraftObject(kind, materials, this.gunmetalMaterial);
      const shadow = new Mesh(AIR_SHADOW_GEOM, this.airShadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 18;
      this.airShadows.set(entity, shadow);
      this.group.add(shadow);
      const washMaterial = new MeshBasicMaterial({
        color: 0xb8ad8b,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
      });
      const wash = new Mesh(ROTOR_WASH_GEOM, washMaterial);
      wash.rotation.x = -Math.PI / 2;
      wash.renderOrder = 19;
      wash.visible = false;
      this.rotorWashes.set(entity, { mesh: wash, material: washMaterial });
      this.group.add(wash);
    } else if (kind === 'harvester') {
      built = createHarvesterObject(materials, this.gunmetalMaterial);
    } else {
      built = createVehicleObject(kind, materials, this.gunmetalMaterial);
    }
    const unit = built.root;
    const scale = visualScaleForEntity(entity);
    unit.scale.set(scale.x, scale.y, scale.z);
    unit.castShadow = true;
    unit.traverse((obj) => {
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    this.objects.set(entity, unit);
    this.refs.set(entity, built.refs);
    this.group.add(unit);

    if (entity.health && kind !== 'rifle' && kind !== 'grenadier' && kind !== 'rocket' && kind !== 'sniper') {
      const overlay = createUnitDamageOverlay(entity, kind, this.vehicleScorchMaterial, this.vehicleCrackMaterial, this.vehicleEmberMaterial);
      this.damageOverlays.set(entity, overlay);
      unit.add(overlay.root);
    }

    const radius = entity.selectable?.type === 'infantry' ? 1.7 : entity.selectable?.type === 'vulture' ? 3.9 : 2.8;
    const ring = new Mesh(sharedRingGeometry(radius), this.ringMaterial);
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

  /**
   * Fully removes a dead entity's render resources — scene objects and per-entity
   * materials — and drops it from every map. Shared unit/overlay geometries and
   * shared materials are module/instance-owned and NOT disposed here.
   */
  private removeEntity(entity: Entity): void {
    const obj = this.objects.get(entity);
    if (obj) {
      this.group.remove(obj);
      obj.traverse((child) => {
        if (child instanceof Mesh && !isSharedUnitGeometry(child.geometry)) child.geometry.dispose();
      });
      this.objects.delete(entity);
    }
    this.refs.delete(entity);
    const ring = this.selectedRings.get(entity);
    if (ring) {
      this.group.remove(ring); // ring geometry is shared — do not dispose
      this.selectedRings.delete(entity);
    }
    const healthBar = this.healthBars.get(entity);
    if (healthBar) {
      this.group.remove(healthBar.root);
      healthBar.fillMaterial.dispose(); // per-entity material
      this.healthBars.delete(entity);
    }
    const shadow = this.airShadows.get(entity);
    if (shadow) {
      this.group.remove(shadow); // shadow geometry + material shared
      this.airShadows.delete(entity);
    }
    const wash = this.rotorWashes.get(entity);
    if (wash) {
      this.group.remove(wash.mesh);
      wash.material.dispose(); // per-entity material
      this.rotorWashes.delete(entity);
    }
    this.soldierRigs.delete(entity);
    this.anims.delete(entity);
    this.wrecked.delete(entity);
    this.damageOverlays.delete(entity);
  }

  private soldierMaterials(team: TeamMaterials): SoldierMaterials {
    return {
      uniform: team.uniform,
      gear: team.dark,
      skin: this.skinMaterial,
      gunmetal: this.gunmetalMaterial,
      accent: team.accent,
      canvas: team.canvas,
      lightBar: team.lightBar,
      visor: this.visorMaterial,
      muzzle: this.muzzleMaterial,
    };
  }

  setHiddenEntity(entity?: Entity): void {
    this.hiddenEntity = entity;
  }

  setSelectionOverlayVisible(visible: boolean): void {
    this.selectionOverlayVisible = visible;
  }

  update(alpha: number, dt: number, camera: Camera): void {
    // Evict entities the sim has finished with (wreck window expired). The possessed
    // unit is only hidden, never evicted here — it's reclaimed when possession ends.
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e !== this.hiddenEntity && e.destroyed !== undefined && e.destroyed.remaining <= 0) {
        this.removeEntity(e);
        this.entities.splice(i, 1);
      }
    }
    for (const entity of this.entities) {
      const obj = this.objects.get(entity);
      const ring = this.selectedRings.get(entity);
      if (!obj || !ring) continue;
      const gone = entity === this.hiddenEntity;
      const fogged = entity.team?.id !== 1 && !this.isVisible(entity.transform.x, entity.transform.z);
      if (gone || fogged) {
        obj.visible = false;
        ring.visible = false;
        const shadow = this.airShadows.get(entity);
        if (shadow) shadow.visible = false;
        const wash = this.rotorWashes.get(entity);
        if (wash) wash.mesh.visible = false;
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
      this.updateUnitDamage(entity, obj);
      const turret = this.refs.get(entity)?.turretPivot;
      if (turret && entity.turret && !entity.destroyed) turret.rotation.y = entity.turret.yaw - rot;
      ring.position.set(x, groundY + 0.08, z);
      const selected = this.selectionOverlayVisible && !entity.destroyed && (entity.selectable?.selected ?? false);
      ring.visible = selected;
      if (selected) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008 + entity.id);
        ring.scale.setScalar(1 + pulse * 0.075);
      } else {
        ring.scale.setScalar(1);
      }
      const shadow = this.airShadows.get(entity);
      if (shadow) {
        const agl = Math.max(0, y - groundY);
        shadow.visible = !entity.destroyed;
        shadow.position.set(x, groundY + 0.09, z);
        shadow.scale.setScalar(Math.max(0.55, 1 + agl / 62));
      }
      const wash = this.rotorWashes.get(entity);
      if (wash) {
        const agl = Math.max(0, y - groundY);
        const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
        const lowAir = Math.max(0, 1 - agl / 30);
        wash.mesh.visible = !entity.destroyed && lowAir > 0.02;
        if (wash.mesh.visible) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012 + entity.id);
          wash.mesh.position.set(x, groundY + 0.12, z);
          wash.mesh.rotation.z += dt * (1.3 + speed * 0.025);
          wash.mesh.scale.setScalar(0.8 + lowAir * (0.85 + pulse * 0.22) + Math.min(0.45, speed / 80));
          wash.material.opacity = lowAir * (0.08 + pulse * 0.08);
        }
      }
      this.updateHealthBar(entity, x, y, z, camera);
    }
  }

  /** Walk cycles, death poses, and wreck states — all driven by sim data. */
  private applyPose(entity: Entity, obj: Object3D, dt: number): void {
    const isInfantry = entity.selectable?.type === 'infantry';
    const refs = this.refs.get(entity);
    if (entity.destroyed) {
      const sinceDeath = Math.max(0, 20 - entity.destroyed.remaining);
      const fall = Math.min(1, sinceDeath / 0.55);
      if (isInfantry) {
        const rig = this.soldierRigs.get(entity);
        const variant = Math.floor(deterministicUnit(entity.id, 0xdead) * 3);
        if (variant === 0) {
          obj.rotation.z = fall * (Math.PI / 2) * 0.96;
          obj.rotation.x = fall * 0.2;
        } else if (variant === 1) {
          obj.rotation.x = fall * (Math.PI / 2) * 0.88;
          obj.rotation.z = deterministicUnitSigned(entity.id, 0xdeaf) * fall * 0.22;
          obj.position.z += fall * 0.22;
        } else {
          obj.rotation.x = -fall * (Math.PI / 2) * 0.82;
          obj.rotation.z = deterministicUnitSigned(entity.id, 0xdec0) * fall * 0.28;
          obj.position.z -= fall * 0.38;
        }
        obj.position.y += 0.12 - fall * 0.2;
        obj.scale.setScalar(1);
        if (rig) {
          rig.hipL.rotation.x = -0.25 * fall;
          rig.hipR.rotation.x = 0.35 * fall;
          rig.kneeL.rotation.x = 0.8 * fall;
          rig.kneeR.rotation.x = 0.45 * fall;
          rig.shoulderL.rotation.x = -0.5 + fall * 0.75;
          rig.shoulderR.rotation.x = -0.5 - fall * 0.35;
          rig.elbowL.rotation.x = -0.35 + fall * 0.45;
          rig.elbowR.rotation.x = -0.4 + fall * 0.32;
          rig.rifle.visible = fall < 0.92 || rig.kit === 'rocket';
          rig.muzzleFlash.visible = false;
          if (rig.backBlast) rig.backBlast.visible = false;
        }
      } else if (!this.wrecked.has(entity)) {
        // tanks become scorched husks that persist
        this.wrecked.add(entity);
        obj.traverse((child) => {
          if (child instanceof Mesh) child.material = this.wreckMaterial;
        });
        obj.rotation.z = 0.09;
        const turret = refs?.turretPivot;
        if (turret) {
          turret.rotation.x = 0.14;
          turret.position.y = -0.12;
        }
      }
      return;
    }

    if (entity.flight) {
      const pitch = lerp(entity.flight.previousPitchAttitude, entity.flight.pitchAttitude, 0.65);
      const roll = lerp(entity.flight.previousRollAttitude, entity.flight.rollAttitude, 0.65);
      obj.rotation.x = pitch;
      obj.rotation.z = -roll;
      const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
      for (const mainRotor of refs?.mainRotors ?? []) {
        mainRotor.rotation.x = -pitch * 0.42;
        mainRotor.rotation.z = roll * 0.42;
        mainRotor.rotation.y += dt * (18 + speed * 1.7 + Math.abs(entity.flight.verticalVelocity) * 0.45);
      }
      for (const tailRotor of refs?.tailRotors ?? []) tailRotor.rotation.x += dt * (24 + speed * 2.2);
      updateMissileRack(refs?.missileRack, entity);
      if (!entity.destroyed) obj.position.y += Math.sin(performance.now() * 0.004 + entity.id) * 0.035;
      return;
    }

    if (entity.selectable?.type === 'harvester') {
      const cargoLoad = refs?.cargoLoad;
      if (cargoLoad) {
        const pct = entity.cargo ? Math.max(0.03, Math.min(1, entity.cargo.amount / entity.cargo.capacity)) : 0.03;
        cargoLoad.visible = pct > 0.04;
        cargoLoad.scale.set(0.55 + pct * 0.45, 0.38 + pct * 0.62, 0.55 + pct * 0.45);
        cargoLoad.position.y = 1.56 + pct * 0.26;
      }
      const scoop = refs?.scoop;
      if (scoop && entity.harvester) {
        const gathering = entity.harvester.state === 'gathering';
        scoop.rotation.x = gathering ? -0.12 + Math.sin(performance.now() * 0.012 + entity.id) * 0.08 : 0;
      }
      const warning = refs?.warningBeacon;
      if (warning && entity.harvester) {
        const threatened = (entity.harvester.threatTimer ?? 0) > 0;
        warning.visible = threatened;
        if (threatened && warning.material instanceof MeshBasicMaterial) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.018 + entity.id);
          warning.material.opacity = 0.34 + pulse * 0.42;
          warning.scale.setScalar(0.85 + pulse * 0.32);
        }
      }
      if (refs?.antenna) refs.antenna.rotation.z = Math.sin(performance.now() * 0.008 + entity.id) * 0.08;
      return;
    }

    if (!isInfantry) {
      if (refs?.antenna) refs.antenna.rotation.z = Math.sin(performance.now() * 0.007 + entity.id) * 0.06;
      if (refs?.barrelPivot && entity.weapons?.secondary?.cooldown && entity.weapons.secondary.cooldown > 0) {
        refs.barrelPivot.rotation.x = -0.16;
      } else if (refs?.barrelPivot) {
        refs.barrelPivot.rotation.x += (0 - refs.barrelPivot.rotation.x) * Math.min(1, dt * 7);
      }
      return;
    }

    const rig = this.soldierRigs.get(entity);
    const anim = this.anims.get(entity);
    if (!rig || !anim) return;
    obj.rotation.x = 0;
    obj.rotation.z = 0;
    const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
    const maxSpeed = entity.mover?.speed ?? 12;
    const speedT = Math.min(1, speed / Math.max(1, maxSpeed));
    const moving = speed > 0.4;
    const weapon = entity.weapons?.primary ?? entity.weapon;
    const cooldown = weapon?.cooldown ?? 0;
    const aiming = (weapon?.targetId !== undefined || cooldown > 0.02) && !entity.destroyed;
    if (cooldown > anim.lastCooldown + 0.08) anim.recoil = rig.kit === 'rocket' ? 0.18 : 0.12;
    anim.lastCooldown = cooldown;
    anim.recoil = Math.max(0, anim.recoil - dt);
    anim.aim += ((aiming ? 1 : 0) - anim.aim) * Math.min(1, dt * 10);
    const shouldCrouch = aiming && speed < 0.4;
    anim.crouch += ((shouldCrouch ? 1 : 0) - anim.crouch) * Math.min(1, dt * 8);
    anim.swing += ((moving ? speedT : 0) - anim.swing) * Math.min(1, dt * 8);
    if (moving) anim.phase += dt * (3.2 + speed * 0.62);

    const s = Math.sin(anim.phase);
    const c = Math.sin(anim.phase + Math.PI);
    const rocketKneel = rig.kit === 'rocket' ? anim.crouch : 0;
    rig.hipL.rotation.x = s * 0.62 * anim.swing - anim.crouch * 0.42 - rocketKneel * 0.42;
    rig.hipR.rotation.x = c * 0.62 * anim.swing - anim.crouch * 0.34 + rocketKneel * 0.25;
    // knee bends as the leg swings back and lifts
    rig.kneeL.rotation.x = Math.max(0, -s) * 0.85 * anim.swing + anim.crouch * 0.72 + rocketKneel * 0.55;
    rig.kneeR.rotation.x = Math.max(0, -c) * 0.85 * anim.swing + anim.crouch * 0.62 + rocketKneel * 1.2;
    // gait bob + a touch of forward lean when running
    obj.position.y += (Math.abs(Math.sin(anim.phase * 2)) * 0.05 - 0.02) * anim.swing - anim.crouch * 0.12 - rocketKneel * 0.08;
    rig.root.rotation.x = 0.04 + 0.1 * speedT * anim.swing - anim.crouch * 0.05;
    // idle breathing
    rig.torso.position.y = 1.12 - anim.crouch * 0.08 + Math.sin(anim.phase * 0.35 + entity.id) * 0.008 * (1 - anim.swing);
    rig.torso.rotation.x = -anim.crouch * 0.08 - (anim.recoil > 0 ? 0.035 : 0);
    const recoilT = Math.min(1, anim.recoil / (rig.kit === 'rocket' ? 0.18 : 0.12));
    const baseWeapon = soldierWeaponBasePose(rig.kit);
    rig.rifle.visible = true;
    rig.rifle.position.set(baseWeapon.x, baseWeapon.y, baseWeapon.z);
    rig.rifle.rotation.set(baseWeapon.rx, baseWeapon.ry, baseWeapon.rz);
    const aimDrop = rig.kit === 'grenadier' ? -0.16 : rig.kit === 'rocket' ? 0.02 : rig.kit === 'sniper' ? -0.05 : -0.08;
    rig.rifle.rotation.x += aimDrop * (1 - anim.aim) - recoilT * 0.1;
    rig.rifle.position.z -= recoilT * (rig.kit === 'rocket' ? 0.07 : 0.045);
    rig.rifle.position.y += anim.aim * (rig.kit === 'rocket' ? 0.02 : 0.04) - anim.crouch * 0.02;
    rig.shoulderR.rotation.x = -0.8 + anim.aim * -0.18 + recoilT * 0.1;
    rig.shoulderL.rotation.x = -0.72 + anim.aim * -0.25;
    rig.elbowR.rotation.x = -0.62 + anim.aim * -0.08 + recoilT * 0.12;
    rig.elbowL.rotation.x = -0.72 + anim.aim * -0.15;
    if (rig.kit === 'rocket') {
      rig.shoulderR.rotation.z = -0.16;
      rig.shoulderL.rotation.z = 0.12;
    }
    rig.muzzleFlash.visible = recoilT > 0.58 && anim.recoil > 0;
    rig.muzzleFlash.scale.setScalar(rig.kit === 'rocket' ? 1.5 : rig.kit === 'sniper' ? 0.8 : 1);
    if (rig.backBlast) {
      rig.backBlast.visible = rig.muzzleFlash.visible;
      rig.backBlast.scale.setScalar(1.2 + recoilT * 0.5);
    }
    if (rig.antenna) rig.antenna.rotation.z = Math.sin(anim.phase * 1.15 + entity.id) * 0.13 * Math.max(0.25, anim.swing);
  }

  private updateUnitDamage(entity: Entity, obj: Object3D): void {
    const overlay = this.damageOverlays.get(entity);
    if (!overlay || !entity.health) return;
    const damage = entity.destroyed ? 1 : Math.max(0, Math.min(1, 1 - entity.health.current / entity.health.max));
    overlay.root.visible = damage >= 0.035;
    if (!overlay.root.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.011 + entity.id);
    for (const patch of overlay.patches) {
      patch.mesh.visible = damage >= patch.threshold;
      if (!patch.mesh.visible) continue;
      if (patch.kind === 'ember') patch.mesh.scale.setScalar(0.78 + pulse * 0.22 + damage * 0.35);
    }
    if (!entity.flight && !entity.destroyed && damage > 0.45) {
      obj.rotation.z += deterministicUnitSigned(entity.id, 0xd46) * Math.min(0.12, (damage - 0.45) * 0.22);
      obj.position.y -= Math.min(0.16, (damage - 0.45) * 0.22);
    }
  }

  pickAt(x: number, z: number, maxRadius = 4.2): Entity | undefined {
    let best: Entity | undefined;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const entity of this.entities) {
      if (!this.isPickable(entity)) continue;
      const radius = Math.max(maxRadius, (entity.selectable?.radius ?? 2.4) * 1.45);
      const d2 = (entity.transform.x - x) ** 2 + (entity.transform.z - z) ** 2;
      if (d2 <= radius * radius && d2 < bestD2) {
        best = entity;
        bestD2 = d2;
      }
    }
    return best;
  }

  pickAtScreen(camera: Camera, screenX: number, screenY: number, viewportW: number, viewportH: number): Entity | undefined {
    let best: Entity | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const entity of this.entities) {
      if (!this.isPickable(entity)) continue;
      const p = projectEntity(entity, this.hf, camera);
      if (p.z < -1 || p.z > 1) continue;
      const sx = (p.x * 0.5 + 0.5) * viewportW;
      const sy = (-p.y * 0.5 + 0.5) * viewportH;
      const d = Math.hypot(sx - screenX, sy - screenY);
      const hitRadius = screenPickRadius(entity);
      if (d > hitRadius) continue;
      const score = d + p.z * 4;
      if (score < bestScore) {
        best = entity;
        bestScore = score;
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

  private isPickable(entity: Entity): boolean {
    if (entity === this.hiddenEntity || entity.destroyed) return false;
    if (entity.team?.id !== 1 && !this.isVisible(entity.transform.x, entity.transform.z)) return false;
    return true;
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

  const back = new Mesh(HEALTH_BACK_GEOM, backMaterial);
  back.renderOrder = 42;
  root.add(back);

  const fillMaterial = new MeshBasicMaterial({ color: 0x79f06f, transparent: true, opacity: 0.92, depthWrite: false, side: DoubleSide });
  const fill = new Mesh(HEALTH_FILL_GEOM, fillMaterial);
  fill.position.z = 0.02;
  fill.renderOrder = 43;
  root.add(fill);

  return { root, fill, fillMaterial };
}

function createUnitDamageOverlay(entity: Entity, kind: UnitVisualKind, scorch: Material, crack: Material, ember: Material): UnitDamageOverlay {
  const root = new Group();
  root.visible = false;
  const patches: UnitDamagePatch[] = [];
  const isAircraft = kind === 'wasp' || kind === 'vulture' || kind === 'hammerhead';
  const isHarvester = kind === 'harvester';
  const topY = isAircraft ? 0.92 : isHarvester ? 2.22 : kind === 'mauler' ? 1.2 : 1.28;
  const spanX = isAircraft ? (kind === 'hammerhead' ? 3.0 : 1.45) : isHarvester ? 2.25 : kind === 'mauler' ? 1.9 : 1.65;
  const spanZ = isAircraft ? (kind === 'wasp' ? 2.25 : kind === 'hammerhead' ? 2.4 : 2.85) : isHarvester ? 2.55 : kind === 'mauler' ? 3.25 : 2.35;
  const scorchThresholds = [0.035, 0.16, 0.3, 0.48, 0.66];
  const crackThresholds = [0.22, 0.38, 0.58, 0.76];
  const emberThresholds = [0.52, 0.7, 0.86];

  for (let i = 0; i < scorchThresholds.length; i++) {
    const mesh = new Mesh(sharedBoxGeometry(1, 0.035, 1), scorch);
    const px = deterministicUnitSigned(entity.id, 0x110 + i) * spanX;
    const pz = deterministicUnitSigned(entity.id, 0x210 + i) * spanZ;
    mesh.position.set(px, topY + i * 0.008, pz);
    mesh.rotation.y = deterministicUnit(entity.id, 0x310 + i) * Math.PI;
    mesh.scale.set(0.78 + deterministicUnit(entity.id, 0x410 + i) * 0.55, 1, 0.42 + deterministicUnit(entity.id, 0x510 + i) * 0.42);
    mesh.renderOrder = 34;
    root.add(mesh);
    patches.push({ mesh, threshold: scorchThresholds[i], kind: 'scorch' });
  }

  for (let i = 0; i < crackThresholds.length; i++) {
    const mesh = new Mesh(sharedBoxGeometry(1.1, 0.045, 0.08), crack);
    const px = deterministicUnitSigned(entity.id, 0x610 + i) * spanX * 0.92;
    const pz = deterministicUnitSigned(entity.id, 0x710 + i) * spanZ * 0.92;
    mesh.position.set(px, topY + 0.05 + i * 0.01, pz);
    mesh.rotation.y = deterministicUnit(entity.id, 0x810 + i) * Math.PI;
    mesh.scale.set(0.85 + deterministicUnit(entity.id, 0x910 + i) * 0.75, 1, 1);
    mesh.renderOrder = 35;
    root.add(mesh);
    patches.push({ mesh, threshold: crackThresholds[i], kind: 'crack' });
  }

  for (let i = 0; i < emberThresholds.length; i++) {
    const mesh = new Mesh(sharedBoxGeometry(0.34, 0.04, 0.34), ember);
    const px = deterministicUnitSigned(entity.id, 0xa10 + i) * spanX * 0.78;
    const pz = deterministicUnitSigned(entity.id, 0xb10 + i) * spanZ * 0.78;
    mesh.position.set(px, topY + 0.09 + i * 0.012, pz);
    mesh.renderOrder = 36;
    root.add(mesh);
    patches.push({ mesh, threshold: emberThresholds[i], kind: 'ember' });
  }

  for (const patch of patches) patch.mesh.visible = false;
  return { root, patches };
}

function createTeamMaterials(ctx: RenderContext, id: FactionId): TeamMaterials {
  const f = FACTION[id];
  return {
    hull: ctx.setupLitMaterial(new MeshStandardMaterial({ color: f.hull, roughness: 0.78, metalness: 0.08 })),
    dark: ctx.setupLitMaterial(new MeshStandardMaterial({ color: f.hullDark, roughness: 0.82, metalness: 0.12 })),
    canvas: ctx.setupLitMaterial(new MeshStandardMaterial({ color: f.canvas, roughness: 0.9, metalness: 0.02 })),
    uniform: ctx.setupLitMaterial(new MeshStandardMaterial({ map: createCamoTexture(id), roughness: 0.92, metalness: 0.01 })),
    accent: ctx.setupLitMaterial(new MeshStandardMaterial({ color: f.accent, emissive: f.accentEmissive, roughness: 0.7, metalness: 0.1 })),
    lightBar: ctx.setupLitMaterial(
      new MeshStandardMaterial({ color: f.lightBar, emissive: f.lightBar, emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.05 }),
    ),
  };
}

function createCamoTexture(id: FactionId): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('camo canvas unavailable');
  const colors =
    id === 2
      ? ['#4a3f38', '#604739', '#2f2b28', '#7a563c']
      : id === 3
        ? ['#3f5260', '#536a75', '#2e3f49', '#6c818c']
        : id === 4
          ? ['#4e5a3d', '#65754d', '#38432f', '#798a5f']
          : ['#55603f', '#687151', '#3c4634', '#7a8060'];
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let seed = 101 + id * 97;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = colors[1 + Math.min(colors.length - 2, Math.floor(rand() * (colors.length - 1)))];
    ctx.globalAlpha = 0.22 + rand() * 0.22;
    const x = rand() * canvas.width;
    const y = rand() * canvas.height;
    const rx = 8 + rand() * 22;
    const ry = 3 + rand() * 10;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000';
    ctx.globalAlpha = 0.025 + rand() * 0.035;
    ctx.fillRect(rand() * canvas.width, rand() * canvas.height, 1, 1);
  }
  ctx.globalAlpha = 1;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(1.4, 1.4);
  tex.needsUpdate = true;
  return tex;
}

function box(x: number, y: number, z: number, material: Material, px: number, py: number, pz: number): Mesh {
  const mesh = new Mesh(sharedBoxGeometry(x, y, z), material);
  mesh.position.set(px, py, pz);
  return mesh;
}

function createVehicleObject(kind: UnitVisualKind, materials: TeamMaterials, gunmetal: Material): BuiltUnit {
  const group = new Group();
  const turretPivot = new Group();
  group.add(turretPivot);
  const barrelPivot = new Group();
  const antenna = new Group();
  if (kind === 'jackal') {
    group.add(box(2.7, 0.72, 4.6, materials.hull, 0, 0.58, 0.18));
    group.add(box(1.7, 0.36, 1.55, materials.accent, 0, 0.98, 1.38));
    for (const side of [-1, 1]) {
      for (const z of [-1.55, 0, 1.55]) {
        const wheel = new Mesh(sharedCylinderGeometry(0.42, 0.42, 0.32, 14), materials.dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 1.55, 0.36, z);
        group.add(wheel);
      }
    }
    turretPivot.position.y = 1.04;
    turretPivot.add(box(1.35, 0.24, 1.35, materials.dark, 0, 0.05, -0.25));
    turretPivot.add(box(1.3, 0.08, 0.32, materials.accent, 0, 0.24, -0.72));
    barrelPivot.position.set(0, 0.16, 0.18);
    barrelPivot.add(box(0.12, 0.12, 2.55, gunmetal, -0.18, 0, 1.36));
    barrelPivot.add(box(0.12, 0.12, 2.55, gunmetal, 0.18, 0, 1.36));
    turretPivot.add(barrelPivot);
    antenna.position.set(1.05, 1.08, -1.75);
  } else if (kind === 'mauler') {
    group.add(box(3.85, 0.72, 7.2, materials.hull, 0, 0.48, -0.3));
    group.add(box(4.55, 0.42, 6.9, materials.dark, 0, 0.34, -0.25));
    group.add(box(2.6, 0.08, 0.42, materials.accent, 0, 0.92, 2.62));
    group.add(box(1.45, 0.28, 0.95, materials.dark, -1.35, 0.48, -3.92));
    group.add(box(1.45, 0.28, 0.95, materials.dark, 1.35, 0.48, -3.92));
    turretPivot.position.set(0, 1.02, -0.92);
    turretPivot.add(box(2.45, 0.48, 2.25, materials.dark, 0, 0, 0));
    turretPivot.add(box(2.2, 0.08, 0.3, materials.accent, 0, 0.3, -0.55));
    barrelPivot.position.set(0, 0.08, 0.8);
    barrelPivot.add(box(0.24, 0.24, 5.9, gunmetal, 0, 0, 2.9));
    barrelPivot.add(box(0.62, 0.2, 0.28, gunmetal, 0, 0, 5.92));
    turretPivot.add(barrelPivot);
    antenna.position.set(-1.45, 1.0, -2.45);
  } else {
    group.add(box(3.6, 0.9, 5.0, materials.hull, 0, 0.6, 0));
    group.add(box(0.62, 0.42, 5.4, materials.dark, -2.02, 0.32, 0));
    group.add(box(0.62, 0.42, 5.4, materials.dark, 2.02, 0.32, 0));
    group.add(box(1.9, 0.08, 0.44, materials.accent, 0, 1.08, 2.15));
    turretPivot.position.y = 1.25;
    turretPivot.add(box(2.1, 0.65, 2.2, materials.dark, 0, 0, 0));
    turretPivot.add(box(2.5, 0.05, 0.32, materials.accent, 0, 0.48, -0.2));
    turretPivot.add(box(0.75, 0.12, 0.22, materials.lightBar, 0, 0.54, -0.9));
    barrelPivot.position.set(0, 0.02, 1.05);
    barrelPivot.add(box(0.28, 0.28, 3.2, gunmetal, 0, 0, 1.6));
    turretPivot.add(barrelPivot);
    const hatch = new Mesh(sharedCylinderGeometry(0.45, 0.55, 0.2, 8), materials.dark);
    hatch.position.set(0, 0.45, -0.35);
    turretPivot.add(hatch);
    antenna.position.set(1.1, 1.15, -1.65);
  }
  const whip = new Mesh(sharedCylinderGeometry(0.012, 0.018, 1.15, 5), gunmetal);
  whip.position.y = 0.58;
  antenna.add(whip);
  group.add(antenna);
  return { root: group, refs: { turretPivot, barrelPivot, antenna } };
}

function createHarvesterObject(materials: TeamMaterials, gunmetal: Material): BuiltUnit {
  const group = new Group();

  group.add(box(4.4, 0.8, 5.7, materials.hull, 0, 0.5, 0));
  group.add(box(3.55, 1.15, 3.05, materials.dark, 0, 1.08, -0.95));
  group.add(box(2.55, 1.45, 1.8, materials.hull, 0, 1.25, 1.85));
  group.add(box(1.78, 0.42, 0.08, materials.accent, 0, 1.55, 2.78));
  group.add(box(2.5, 0.09, 0.34, materials.lightBar, 0, 2.05, 1.2));

  const load = box(2.85, 0.34, 2.15, materials.accent, 0, 1.82, -1.05);
  group.add(load);

  const scoop = new Group();
  scoop.position.set(0, 0.45, 3.35);
  const scoopBlade = new Mesh(sharedBoxGeometry(4.8, 0.34, 0.72), materials.dark);
  scoopBlade.rotation.x = -0.25;
  scoop.add(scoopBlade);
  scoop.add(box(0.22, 0.22, 1.45, materials.dark, -1.55, 0.22, -0.72));
  scoop.add(box(0.22, 0.22, 1.45, materials.dark, 1.55, 0.22, -0.72));
  group.add(scoop);

  const tankL = new Mesh(sharedCylinderGeometry(0.36, 0.36, 2.55, 12), materials.dark);
  tankL.rotation.z = Math.PI / 2;
  tankL.position.set(-2.45, 0.92, -0.95);
  group.add(tankL);
  const tankR = new Mesh(sharedCylinderGeometry(0.36, 0.36, 2.55, 12), materials.dark);
  tankR.rotation.z = Math.PI / 2;
  tankR.position.set(2.45, 0.92, -0.95);
  group.add(tankR);

  group.add(box(0.72, 0.46, 6.25, materials.dark, -2.45, 0.28, 0));
  group.add(box(0.72, 0.46, 6.25, materials.dark, 2.45, 0.28, 0));
  group.add(box(3.0, 0.08, 0.34, materials.accent, 0, 2.04, -1.02));

  const beaconMaterial = new MeshBasicMaterial({ color: 0xff3d24, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false });
  const beacon = new Mesh(sharedBoxGeometry(0.68, 0.24, 0.68), beaconMaterial);
  beacon.position.set(0, 2.32, 1.65);
  beacon.visible = false;
  group.add(beacon);

  const antenna = new Group();
  antenna.position.set(1.15, 2.2, 0.95);
  const whip = new Mesh(sharedCylinderGeometry(0.012, 0.018, 0.82, 5), gunmetal);
  whip.position.y = 0.42;
  antenna.add(whip);
  group.add(antenna);
  return { root: group, refs: { cargoLoad: load, scoop, warningBeacon: beacon, antenna } };
}

function createAircraftObject(kind: UnitVisualKind, materials: TeamMaterials, rotorMaterial: Material): BuiltUnit {
  const group = new Group();
  const mainRotors: Object3D[] = [];
  const tailRotors: Object3D[] = [];
  const missileRack: Object3D[] = [];

  if (kind === 'wasp') {
    group.add(box(1.35, 0.78, 3.35, materials.hull, 0, 0.18, 0.45));
    group.add(box(1.1, 0.5, 0.78, materials.accent, 0, 0.26, 1.95));
    group.add(box(0.38, 0.32, 3.35, materials.hull, 0, 0.28, -2.45));
    group.add(box(0.2, 1.05, 0.7, materials.accent, 0, 0.75, -4.1));
    group.add(box(0.28, 0.22, 1.4, rotorMaterial, 0, -0.18, 1.55));
    addSkids(group, rotorMaterial, 1.0, 3.2);
    mainRotors.push(addRotor(group, rotorMaterial, 5.6, 0, 0.95, 0));
    tailRotors.push(addTailRotor(group, rotorMaterial, 0, 0.55, -4.45));
  } else if (kind === 'hammerhead') {
    group.add(box(3.5, 0.92, 4.7, materials.hull, 0, 0.22, 0.15));
    group.add(box(3.8, 0.62, 1.25, materials.accent, 0, 0.26, 2.3));
    group.add(box(6.3, 0.28, 1.2, materials.dark, 0, 0.28, -0.3));
    group.add(box(0.42, 0.9, 0.82, materials.accent, -1.35, 0.58, -2.55));
    group.add(box(0.42, 0.9, 0.82, materials.accent, 1.35, 0.58, -2.55));
    addSkids(group, rotorMaterial, 1.75, 4.1);
    mainRotors.push(addRotor(group, rotorMaterial, 5.8, -2.7, 1.02, -0.22));
    mainRotors.push(addRotor(group, rotorMaterial, 5.8, 2.7, 1.02, -0.22));
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const missile = new Mesh(sharedCylinderGeometry(0.07, 0.07, 0.86, 8), materials.lightBar);
        missile.rotation.x = Math.PI / 2;
        missile.position.set(side * 2.15, -0.08, -0.95 + i * 0.5);
        group.add(missile);
        missileRack.push(missile);
      }
    }
  } else {
    group.add(box(2.2, 1.0, 5.2, materials.hull, 0, 0.25, 0));
    group.add(box(1.35, 0.72, 1.45, materials.accent, 0, 0.28, 2.55));
    group.add(box(0.55, 0.45, 4.2, materials.hull, 0, 0.32, -4.2));
    group.add(box(3.8, 0.18, 1.1, materials.dark, 0, 0.05, 0.95));
    addSkids(group, rotorMaterial, 1.35, 4.2);
    mainRotors.push(addRotor(group, rotorMaterial, 8.0, 0, 1.48, 0));
    tailRotors.push(addTailRotor(group, rotorMaterial, 0, 0.5, -6.35));
    for (const side of [-1, 1]) {
      const pod = new Mesh(sharedCylinderGeometry(0.18, 0.18, 1.6, 10), rotorMaterial);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(side * 1.42, 0.05, 1.25);
      group.add(pod);
    }
    group.add(box(0.24, 0.82, 0.72, materials.accent, 0, 0.82, -5.25));
    group.add(box(0.42, 0.38, 0.42, materials.lightBar, 0, 0.65, -6.05));
  }
  return { root: group, refs: { mainRotors, tailRotors, missileRack } };
}

function addRotor(group: Group, material: Material, span: number, x: number, y: number, z: number): Group {
  const mast = new Mesh(sharedCylinderGeometry(0.11, 0.13, 0.72, 10), material);
  mast.position.set(x, y - 0.42, z);
  group.add(mast);
  const mainRotor = new Group();
  mainRotor.position.set(x, y, z);
  const bladeA = new Mesh(sharedBoxGeometry(span, 0.045, 0.26), material);
  const bladeB = new Mesh(sharedBoxGeometry(0.26, 0.045, span), material);
  mainRotor.add(bladeA, bladeB);
  group.add(mainRotor);
  return mainRotor;
}

function addTailRotor(group: Group, material: Material, x: number, y: number, z: number): Group {
  const tailRotor = new Group();
  tailRotor.position.set(x, y, z);
  const tailBladeA = new Mesh(sharedBoxGeometry(0.09, 1.45, 0.12), material);
  const tailBladeB = new Mesh(sharedBoxGeometry(1.45, 0.09, 0.12), material);
  tailRotor.add(tailBladeA, tailBladeB);
  group.add(tailRotor);
  return tailRotor;
}

function addSkids(group: Group, material: Material, width: number, length: number): void {
  group.add(box(0.18, 0.16, length, material, -width, -0.65, 0.15));
  group.add(box(0.18, 0.16, length, material, width, -0.65, 0.15));
  group.add(box(width * 2.15, 0.12, 0.16, material, 0, -0.55, 1.35));
  group.add(box(width * 2.15, 0.12, 0.16, material, 0, -0.55, -1.25));
}

function updateMissileRack(rack: Object3D[] | undefined, entity: Entity): void {
  if (!rack || rack.length === 0) return;
  const cooldown = entity.weapons?.primary.kind === 'agMissile' ? (entity.weapons.primary.cooldown ?? 0) : 0;
  const hidden = cooldown > 0 ? Math.min(rack.length, Math.max(1, Math.ceil(cooldown * 1.5))) : 0;
  for (let i = 0; i < rack.length; i++) rack[i].visible = i >= hidden;
}

function soldierWeaponBasePose(kit: SoldierRig['kit']): { x: number; y: number; z: number; rx: number; ry: number; rz: number } {
  if (kit === 'grenadier') return { x: 0.02, y: 0.22, z: 0.32, rx: -0.28, ry: 0, rz: 0 };
  if (kit === 'rocket') return { x: 0, y: 0.52, z: 0.33, rx: 0.02, ry: 0, rz: -0.05 };
  if (kit === 'sniper') return { x: 0.08, y: 0.42, z: 0.31, rx: -0.16, ry: 0, rz: 0 };
  return { x: 0.08, y: 0.31, z: 0.28, rx: -0.08, ry: 0, rz: 0 };
}

function visualScaleForEntity(entity: Entity): { x: number; y: number; z: number } {
  const name = entity.name ?? '';
  if (entity.weapon?.kind === 'sniperRifle') return { x: 0.96, y: 1.05, z: 0.96 };
  if (entity.selectable?.type === 'harvester') return { x: 1.08, y: 1.0, z: 1.05 };
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

function screenPickRadius(entity: Entity): number {
  if (entity.selectable?.type === 'infantry') return 22;
  if (entity.selectable?.type === 'vulture') return 30;
  if (entity.selectable?.type === 'harvester') return 32;
  return 28;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function deterministicUnit(id: number, seed: number): number {
  const n = Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function deterministicUnitSigned(id: number, seed: number): number {
  return deterministicUnit(id, seed) * 2 - 1;
}
