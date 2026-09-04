import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  type Camera,
  type BufferGeometry,
  type Material,
  type Scene,
  type Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Entity } from '../sim/components';
import { escortDroneLocalPosition } from '../sim/combat';
import type { ImpactZone } from '../sim/impactModel';
import type { CombatEvent } from '../sim/world';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { factionCamoColors, factionId, FACTION, type FactionId } from './palette';
import type { RenderContext, VisualQualityTier } from './renderer';
import { buildSoldier, type SoldierMaterials, type SoldierRig } from './soldier';
import { unitVisualKind, type UnitVisualKind } from './unitKinds';
import {
  hasUnitUpgrade,
  unitKindForUpgrade,
  upgradeOptionsForKind,
  type UnitUpgradeId,
} from '../sim/upgrades';

interface AnimState {
  phase: number; // walk-cycle phase, radians
  swing: number; // 0..1 blend between idle and walking pose
  aim: number;
  crouch: number;
  recoil: number;
  lastCooldown: number;
  bikeLean: number;
  bikeSteer: number;
  bikePitch: number;
  bikeSpeed: number;
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
  barrelHomeZ?: number;
  muzzleFlash?: Mesh;
  groundDrive?: boolean;
  lastPrimaryCooldown?: number;
  recoil?: number;
  mainRotors?: Object3D[];
  tailRotors?: Object3D[];
  cargoLoad?: Object3D;
  scoop?: Object3D;
  harvestingRotor?: Object3D;
  conveyorRollers?: Object3D[];
  warningBeacon?: Mesh;
  antenna?: Object3D;
  missileRack?: Object3D[];
  upgradeVisuals?: Map<UnitUpgradeId, Object3D>;
  escortDrone?: Object3D;
  escortDroneRotors?: Object3D[];
}

interface BuiltUnit {
  root: Object3D;
  refs: UnitRefs;
}

interface UnitDamagePatch {
  mesh: Mesh;
  stage: UnitDamageStage;
  kind: 'scorch' | 'crack' | 'ember';
}

interface UnitDamageEffect {
  mesh: Mesh;
  stage: UnitDamageStage;
  kind: 'smoke' | 'fire';
  baseX: number;
  baseY: number;
  baseZ: number;
  baseScale: number;
  phase: number;
}

interface UnitDamageOverlay {
  root: Group;
  patches: UnitDamagePatch[];
  effects: UnitDamageEffect[];
}

interface FriendlyGlowMesh {
  mesh: InstancedMesh;
  count: number;
}

export interface GroundVehicleTerrainAttitude {
  y: number;
  pitch: number;
  roll: number;
}

// Keep traversable extreme terrain playable without making a tracked vehicle
// look as though it is falling onto its side. The softened suspension still
// communicates the grade, but caps the visual chassis angle at 32 degrees.
const MAX_GROUND_VEHICLE_TILT = Math.PI * (32 / 180);

/** Samples the chassis footprint so vehicles follow the slope instead of clipping through it. */
export function groundVehicleTerrainAttitude(
  hf: Heightfield,
  x: number,
  z: number,
  yaw: number,
  radius: number,
): GroundVehicleTerrainAttitude {
  const safeRadius = Math.max(0.8, radius);
  const halfLength = Math.max(1.35, safeRadius * 1.3);
  const halfWidth = Math.max(0.95, safeRadius * 0.82);
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const front = sampleHeight(hf, x + forwardX * halfLength, z + forwardZ * halfLength);
  const rear = sampleHeight(hf, x - forwardX * halfLength, z - forwardZ * halfLength);
  const right = sampleHeight(hf, x + rightX * halfWidth, z + rightZ * halfWidth);
  const left = sampleHeight(hf, x - rightX * halfWidth, z - rightZ * halfWidth);
  const center = sampleHeight(hf, x, z);
  const clampTilt = (angle: number): number => Math.max(-MAX_GROUND_VEHICLE_TILT, Math.min(MAX_GROUND_VEHICLE_TILT, angle));
  return {
    // On convex ridges, use the higher axle pair so the hull belly cannot cut
    // through the ground while the front and rear suspension remain planted.
    y: Math.max(center, (front + rear) * 0.5, (right + left) * 0.5),
    // Three.js positive X rotation lowers local +Z, hence the negative uphill pitch.
    pitch: clampTilt(-Math.atan2(front - rear, halfLength * 2)),
    roll: clampTilt(Math.atan2(right - left, halfWidth * 2)),
  };
}

type LowDetailKind = 'infantry' | 'vehicle' | 'aircraft';

interface LowDetailMesh {
  body: InstancedMesh;
  color: InstancedMesh;
  detail: InstancedMesh;
  count: number;
}

interface BikeDustParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  lifetime: number;
  scale: number;
}

interface UnitHitReaction {
  elapsed: number;
  duration: number;
  force: number;
  shove: number;
  lift: number;
  angular: number;
  dirX: number;
  dirZ: number;
  localSide: number;
  localForward: number;
  sign: number;
  zone: NonNullable<CombatEvent['impactZone']>;
  topFactor: number;
  hitCount: number;
  intensity: number;
  killed: boolean;
}

export interface ImpactReactionProfile {
  intensity: number;
  duration: number;
  shove: number;
  lift: number;
  angular: number;
}

export type UnitDamageStage = 0 | 1 | 2 | 3;

/** Three readable visual states: worn at 75%, damaged at 50%, critical at 25%. */
export function unitDamageStage(currentHealth: number, maxHealth: number): UnitDamageStage {
  if (!Number.isFinite(currentHealth) || !Number.isFinite(maxHealth) || maxHealth <= 0) return 0;
  const health = Math.max(0, Math.min(1, currentHealth / maxHealth));
  if (health <= 0.25) return 3;
  if (health <= 0.5) return 2;
  if (health <= 0.75) return 1;
  return 0;
}

export function impactReactionProfile(
  force: number,
  impactKind: string | undefined,
  targetKind: UnitVisualKind,
  killed = false,
): ImpactReactionProfile {
  const weaponResponse =
    impactKind === 'annihilatorMissile' || impactKind === 'tankBomb' ? 1.38
      : impactKind === 'bomb' || impactKind === 'siegeMissile' || impactKind === 'agMissile' ? 1.24
        : impactKind === 'tankMissile' || impactKind === 'rocketLauncher' || impactKind === 'swarmRocket' ? 1.1
          : impactKind === 'grenade' || impactKind === 'clusterGrenade' || impactKind === 'aaMissile' ? 0.94
            : impactKind === 'heavyCannon' || impactKind === 'railShot' ? 0.82
              : impactKind === 'cannon' || impactKind === 'scoutMissile' || impactKind === 'rocketPod' ? 0.7
                : 0.42;
  const targetResponse =
    targetKind === 'rifle' || targetKind === 'grenadier' || targetKind === 'rocket' || targetKind === 'sniper' ? 1.65
      : targetKind === 'jackal' ? 1.35
        : targetKind === 'm17' ? 1
          : targetKind === 'mauler' ? 0.68
            : targetKind === 'harvester' ? 0.76
              : 0.9;
  const infantry = targetKind === 'rifle' || targetKind === 'grenadier' || targetKind === 'rocket' || targetKind === 'sniper';
  const intensity = Math.max(0, Math.min(1.6, force * weaponResponse * targetResponse));
  if (infantry) {
    const fatalBoost = killed ? 1.16 : 1;
    const knockdown = smoothRange(0.28, 0.72, intensity);
    return {
      intensity,
      duration: (0.72 + intensity * 0.46 + knockdown * 1.18 + (killed ? 0.28 : 0)) * fatalBoost,
      shove: (0.18 + intensity * 2.8) * fatalBoost,
      lift: (0.12 + intensity * 1.38) * (killed ? 1.24 : 1),
      angular: (0.28 + intensity * 2.25) * fatalBoost,
    };
  }
  return {
    intensity,
    duration: 0.46 + intensity * 0.52 + (killed ? 0.38 : 0),
    shove: 0.05 + intensity * 0.34,
    lift: 0.03 + intensity * 0.48,
    angular: Math.min(0.55, 0.04 + intensity * 0.32),
  };
}

export type InfantryImpactPhase = 'stumble' | 'airborne' | 'grounded' | 'brace' | 'recover';

export interface InfantryImpactPose {
  phase: InfantryImpactPhase;
  lift: number;
  shove: number;
  pitch: number;
  roll: number;
  grounded: number;
  brace: number;
  crouch: number;
  limbBlend: number;
}

/** Staged procedural knockdown: launch, contact, brace, then stand. */
export function infantryImpactPose(
  progress: number,
  intensity: number,
  localSide: number,
  localForward: number,
  killed = false,
): InfantryImpactPose {
  const t = Math.max(0, Math.min(1, progress));
  const strength = Math.max(0, Math.min(1.6, intensity));
  const knockdown = smoothRange(0.28, 0.72, strength);
  const sign = localSide >= 0 ? 1 : -1;
  if (knockdown < 0.08) {
    const pulse = Math.sin(t * Math.PI);
    return {
      phase: 'stumble',
      lift: pulse * 0.04 * strength,
      shove: pulse * 0.28,
      pitch: -localForward * pulse * (0.08 + strength * 0.18),
      roll: (localSide || sign * 0.3) * pulse * (0.08 + strength * 0.16),
      grounded: 0,
      brace: 0,
      crouch: pulse * 0.42,
      limbBlend: pulse * 0.5,
    };
  }

  const maxAngle = 0.34 + knockdown * 1.08;
  const pitchShare = Math.max(0.18, Math.abs(localForward));
  const rollShare = Math.max(0.22, Math.abs(localSide));
  const pitchSign = -Math.sign(localForward || 1);
  const rollSign = Math.sign(localSide || sign);
  const rotation = (factor: number) => ({
    pitch: pitchSign * maxAngle * pitchShare * factor,
    roll: rollSign * maxAngle * rollShare * factor,
  });

  if (t < 0.22) {
    const q = t / 0.22;
    const eased = 1 - (1 - q) * (1 - q);
    const angles = rotation(eased);
    return {
      phase: 'airborne',
      lift: Math.sin(q * Math.PI) * (0.28 + strength * 0.72),
      shove: eased * 0.7,
      ...angles,
      grounded: 0,
      brace: 0,
      crouch: 0,
      limbBlend: eased * 0.72,
    };
  }

  if (t < 0.5 || killed) {
    const q = Math.max(0, Math.min(1, (t - 0.22) / 0.28));
    const angles = rotation(1 - q * 0.04);
    return {
      phase: 'grounded',
      lift: Math.sin(q * Math.PI) * 0.06 * knockdown,
      shove: 0.7 + (1 - Math.exp(-q * 3)) * 0.22,
      ...angles,
      grounded: 1,
      brace: 0,
      crouch: 0,
      limbBlend: 1,
    };
  }

  if (t < 0.72) {
    const q = smoothRange(0, 1, (t - 0.5) / 0.22);
    const angles = rotation(1 - q * 0.68);
    return {
      phase: 'brace',
      lift: 0,
      shove: 0.92,
      ...angles,
      grounded: 1 - q,
      brace: q,
      crouch: q,
      limbBlend: 1,
    };
  }

  const q = smoothRange(0, 1, (t - 0.72) / 0.28);
  const angles = rotation(0.32 * (1 - q));
  return {
    phase: 'recover',
    lift: 0,
    shove: 0.92 * (1 - q),
    ...angles,
    grounded: 0,
    brace: 1 - q,
    crouch: 1 - q,
    limbBlend: 1 - q,
  };
}

function smoothRange(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface GroundVehicleImpactInput {
  progress: number;
  force: number;
  intensity?: number;
  zone: ImpactZone;
  localSide: number;
  localForward: number;
  killed?: boolean;
}

export interface GroundVehicleImpactPose {
  pitch: number;
  roll: number;
  lift: number;
  shove: number;
  flip: boolean;
}

/** One punch that peaks quickly and returns to 0. Never crosses into extra revolutions. */
function punchEnvelope(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (t <= 0 || t >= 1) return 0;
  const peakAt = 0.2;
  if (t < peakAt) {
    const q = t / peakAt;
    return q * q * (3 - 2 * q);
  }
  const q = (t - peakAt) / (1 - peakAt);
  return (1 - q) * (1 - q) * (1 + 0.28 * q);
}

/** Ease to 1 and stay there — used for a single flip that settles on its side or roof. */
function flipEnvelope(progress: number): number {
  const q = Math.max(0, Math.min(1, progress / 0.42));
  return 1 - (1 - q) ** 3;
}

/**
 * Tank hit pose: throw-axis roll/pitch, optional one-time flip, no yaw carousel.
 * Surviving hulls rock and recover. Fatal hits with enough lever can rest inverted.
 */
export function groundVehicleImpactPose(input: GroundVehicleImpactInput): GroundVehicleImpactPose {
  const t = Math.max(0, Math.min(1, input.progress));
  const force = Math.max(0, Math.min(1.35, input.force));
  const intensity = Math.max(0, Math.min(1.6, input.intensity ?? force));
  const killed = input.killed === true;
  const throwSide = input.localSide >= 0 ? 1 : -1;
  // Tip away from the struck flank: a right-side hit throws left and lifts the right side.
  const side = -throwSide;
  const pitchSign = -Math.sign(input.localForward || 1);
  const sideHit = input.zone === 'left' || input.zone === 'right';
  const endHit = input.zone === 'front' || input.zone === 'rear';
  const topHit = input.zone === 'top';
  const canFlip = !topHit
    && (sideHit || endHit)
    && intensity >= (killed ? 0.5 : 0.94)
    && force >= (killed ? 0.34 : 0.7);

  if (killed) {
    const q = flipEnvelope(t);
    const roll = side * (canFlip && sideHit ? Math.PI * 0.58 : 0.14);
    const pitch = pitchSign * (canFlip && endHit ? Math.PI * 0.58 : canFlip ? 0.16 : 0.08);
    const launch = Math.sin(Math.min(1, t * 1.55) * Math.PI);
    return {
      pitch: pitch * q,
      roll: roll * q,
      lift: launch * (0.16 + force * 0.5) * (1 - q * 0.72),
      shove: q * 0.28,
      flip: canFlip,
    };
  }

  const punch = punchEnvelope(t);
  let maxRoll = 0.14 + intensity * 0.36;
  let maxPitch = 0.1 + intensity * 0.26;
  if (canFlip) {
    maxRoll = sideHit ? 1.72 : 0.28;
    maxPitch = endHit ? 1.55 : 0.22;
  }
  if (topHit) {
    maxRoll *= 0.32;
    maxPitch *= 0.38;
  } else if (sideHit) {
    maxPitch *= 0.2;
  } else if (endHit) {
    maxRoll *= 0.2;
  }
  const compression = topHit ? Math.sin(Math.min(1, t * 2.2) * Math.PI) * Math.exp(-t * 2.8) : 0;
  return {
    pitch: pitchSign * maxPitch * punch,
    roll: side * maxRoll * punch,
    lift: (0.03 + force * 0.4) * punch - compression * 0.16,
    shove: punch * 0.5,
    flip: false,
  };
}

export interface PerformanceDetailDecision {
  distanceSquared: number;
  selected: boolean;
  playerControlled: boolean;
  priority: boolean;
  resolvedByFortressOptics: boolean;
  crashingAircraft: boolean;
  destroyed: boolean;
}

/**
 * Performance mode is allowed to simplify only distant background units.
 * Anything the player can currently inspect or interact with retains its real
 * model, animations, damage state, turret direction, and upgrade visuals.
 */
export function shouldKeepDetailedUnitInPerformanceMode(decision: PerformanceDetailDecision): boolean {
  if (decision.crashingAircraft) return true;
  if (decision.destroyed) return false;
  return decision.selected ||
    decision.playerControlled ||
    decision.priority ||
    decision.resolvedByFortressOptics ||
    decision.distanceSquared <= PERFORMANCE_DETAIL_RANGE_SQ;
}

// Unit and overlay geometries are shared by dimensions, so spawning visual variants
// does not allocate fresh GPU shapes for every entity.
const HEALTH_BACK_GEOM = new PlaneGeometry(4.1, 0.48);
const HEALTH_FILL_GEOM = new PlaneGeometry(3.6, 0.22);
const AIR_SHADOW_GEOM = new CircleGeometry(3.8, 32);
const ROTOR_WASH_GEOM = new RingGeometry(1.8, 5.2, 48);
const FRIENDLY_GLOW_GEOM = new SphereGeometry(1, 16, 10);
const MAX_FRIENDLY_GLOWS = 1024;
const BIKE_DUST_GEOM = new SphereGeometry(1, 8, 5);
const sharedGeometryTag = 'ironDominionSharedUnitGeometry';
const UNIT_DAMAGE_SMOKE_GEOM = markShared(new SphereGeometry(1, 8, 6));
const UNIT_DAMAGE_FIRE_GEOM = markShared(new SphereGeometry(1, 7, 5));
const MAX_BIKE_DUST_PARTICLES = 256;
const MAX_LOW_DETAIL_UNITS = 1024;
const FORTRESS_OPTICS_DETAIL_RANGE_SQ = 500 * 500;
const PERFORMANCE_DETAIL_RANGE_SQ = 520 * 520;
const ORE_CHUNK_GEOM = markShared(new SphereGeometry(1, 6, 4));
const boxGeometryCache = new Map<string, BoxGeometry>();
const cylinderGeometryCache = new Map<string, CylinderGeometry>();
const ringGeometryCache = new Map<number, RingGeometry>();
const mergedUnitGeometryCache = new Map<string, BufferGeometry>();

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
  private readonly entitiesById = new Map<number, Entity>();
  private readonly refs = new Map<Entity, UnitRefs>();
  private readonly selectedRings = new Map<Entity, Mesh>();
  private readonly entities: Entity[] = [];
  private readonly teamMaterials: Record<FactionId, TeamMaterials>;
  private readonly friendlyGlow: FriendlyGlowMesh;
  private readonly glowTransform = new Object3D();
  private readonly lowDetailMeshes: Record<FactionId, Record<LowDetailKind, LowDetailMesh>>;
  private readonly lowDetailTransform = new Object3D();
  private readonly bikeDustMesh: InstancedMesh;
  private readonly bikeDustTransform = new Object3D();
  private readonly bikeDustParticles: BikeDustParticle[] = [];
  private readonly bikeDustSpawn = new Map<Entity, number>();
  private bikeDustSerial = 0;
  private visualQuality: VisualQualityTier = 0;
  private visualFrame = 0;
  private readonly accentBoostTargets: { material: MeshStandardMaterial; base: number }[] = [];
  private readonly wreckMaterial: Material;
  private readonly vehicleScorchMaterial: Material;
  private readonly vehicleCrackMaterial: Material;
  private readonly vehicleEmberMaterial: Material;
  private readonly vehicleSmokeMaterial: Material;
  private readonly ringMaterial: Material;
  private readonly healthBackMaterial: Material;
  private readonly skinMaterial: Material;
  private readonly gunmetalMaterial: Material;
  private readonly visorMaterial: Material;
  private readonly muzzleMaterial: MeshBasicMaterial;
  private readonly healthBars = new Map<Entity, { root: Group; fill: Mesh; fillMaterial: MeshBasicMaterial }>();
  private readonly rankBadges = new Map<Entity, { root: Group; material: MeshBasicMaterial; rank: number }>();
  private readonly soldierRigs = new Map<Entity, SoldierRig>();
  private readonly anims = new Map<Entity, AnimState>();
  private readonly airShadows = new Map<Entity, Mesh>();
  private readonly rotorWashes = new Map<Entity, { mesh: Mesh; material: MeshBasicMaterial }>();
  private readonly damageOverlays = new Map<Entity, UnitDamageOverlay>();
  private readonly hitReactions = new Map<Entity, UnitHitReaction>();
  private readonly wreckTilts = new Map<Entity, { pitch: number; roll: number }>();
  private readonly groundAttitudes = new Map<Entity, GroundVehicleTerrainAttitude>();
  private readonly airShadowMaterial = new MeshBasicMaterial({ color: 0x020403, transparent: true, opacity: 0.26, depthWrite: false });
  private readonly wrecked = new Set<Entity>();
  private hiddenEntity?: Entity;
  private priorityDetailedEntity?: Entity;
  private fortressOpticsActive = false;
  private selectionOverlayVisible = true;

  constructor(
    entities: Entity[],
    private readonly hf: Heightfield,
    ctx: RenderContext,
    private readonly isVisible: (x: number, z: number) => boolean = () => true,
    private readonly localTeam = 1,
  ) {
    this.teamMaterials = {
      1: createTeamMaterials(ctx, 1, localTeam === 1),
      2: createTeamMaterials(ctx, 2, localTeam === 2),
      3: createTeamMaterials(ctx, 3, localTeam === 3),
      4: createTeamMaterials(ctx, 4, localTeam === 4),
    };
    const ownMaterials = this.teamMaterials[factionId(localTeam)];
    for (const material of Object.values(ownMaterials)) {
      if (material instanceof MeshStandardMaterial && material.emissiveIntensity > 0) {
        this.accentBoostTargets.push({ material, base: material.emissiveIntensity });
      }
    }
    this.lowDetailMeshes = {
      1: createLowDetailMeshes(ctx, 1),
      2: createLowDetailMeshes(ctx, 2),
      3: createLowDetailMeshes(ctx, 3),
      4: createLowDetailMeshes(ctx, 4),
    };
    for (const meshes of Object.values(this.lowDetailMeshes)) {
      for (const proxy of Object.values(meshes)) this.group.add(proxy.body, proxy.color, proxy.detail);
    }
    this.friendlyGlow = createFriendlyGlowMesh(factionId(localTeam));
    this.group.add(this.friendlyGlow.mesh);
    this.bikeDustMesh = createBikeDustMesh(hf.kind);
    this.group.add(this.bikeDustMesh);
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
    this.vehicleSmokeMaterial = new MeshBasicMaterial({
      color: 0x252321,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: true,
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
    this.ringMaterial = new MeshBasicMaterial({
      color: FACTION[factionId(localTeam)].lightBar,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
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
    this.entitiesById.set(entity.id, entity);
    const kind = unitVisualKind(entity);
    const materials = this.teamMaterials[factionId(entity.team?.id)];
    let built: BuiltUnit;
    if (kind === 'rifle' || kind === 'grenadier' || kind === 'rocket' || kind === 'sniper') {
      const rig = buildSoldier(this.soldierMaterials(materials), kind);
      this.soldierRigs.set(entity, rig);
      this.anims.set(entity, {
        phase: 0,
        swing: 0,
        aim: 0,
        crouch: 0,
        recoil: 0,
        lastCooldown: entity.weapon?.cooldown ?? entity.weapons?.primary.cooldown ?? 0,
        bikeLean: 0,
        bikeSteer: 0,
        bikePitch: 0,
        bikeSpeed: 0,
      });
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
      built = createVehicleObject(kind, materials, this.gunmetalMaterial, this.muzzleMaterial);
    }
    const unit = built.root;
    built.refs.upgradeVisuals = createUnitUpgradeVisuals(entity, materials, this.gunmetalMaterial);
    for (const visual of built.refs.upgradeVisuals.values()) unit.add(visual);
    const escortVisual = built.refs.upgradeVisuals.get('reactive-plating');
    built.refs.escortDrone = escortVisual?.getObjectByName('escortDrone');
    built.refs.escortDroneRotors = built.refs.escortDrone?.children.filter((child) => child.name === 'escortDroneRotor');
    const scale = visualScaleForEntity(entity);
    unit.scale.set(scale.x, scale.y, scale.z);
    unit.castShadow = false;
    unit.traverse((obj) => {
      obj.castShadow = false;
      obj.receiveShadow = true;
    });
    this.objects.set(entity, unit);
    this.refs.set(entity, built.refs);
    this.group.add(unit);

    if (entity.health && kind !== 'rifle' && kind !== 'grenadier' && kind !== 'rocket' && kind !== 'sniper') {
      const overlay = createUnitDamageOverlay(
        entity,
        kind,
        this.vehicleScorchMaterial,
        this.vehicleCrackMaterial,
        this.vehicleEmberMaterial,
        this.vehicleSmokeMaterial,
      );
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
    if (entity.mover && (entity.weapon || entity.weapons) && !entity.harvester) {
      const badge = createRankBadge();
      this.rankBadges.set(entity, badge);
      this.group.add(badge.root);
    }
  }

  attach(scene: Scene): void {
    scene.add(this.group);
  }

  count(): number {
    return this.entities.length;
  }

  syncEntities(entities: Iterable<Entity>): void {
    const next = new Set(Array.from(entities).filter((entity) => entity.selectable && !entity.building));
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i];
      if (next.has(entity)) continue;
      this.removeEntity(entity);
      this.entities.splice(i, 1);
    }
    for (const entity of next) this.addEntity(entity);
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
    this.entitiesById.delete(entity.id);
    this.hitReactions.delete(entity);
    this.wreckTilts.delete(entity);
    this.groundAttitudes.delete(entity);
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
    const rankBadge = this.rankBadges.get(entity);
    if (rankBadge) {
      this.group.remove(rankBadge.root);
      rankBadge.material.dispose();
      this.rankBadges.delete(entity);
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
    this.bikeDustSpawn.delete(entity);
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

  setPriorityDetailedEntity(entity?: Entity): void {
    this.priorityDetailedEntity = entity;
  }

  setAccentEmissiveMul(multiplier: number): void {
    const mul = Math.max(1, multiplier);
    for (const target of this.accentBoostTargets) target.material.emissiveIntensity = target.base * mul;
  }

  setFortressOpticsActive(active: boolean): void {
    this.fortressOpticsActive = active;
  }

  setSelectionOverlayVisible(visible: boolean): void {
    this.selectionOverlayVisible = visible;
  }

  pushCombatEvents(events: CombatEvent[]): void {
    for (const event of events) {
      if (event.kind !== 'impact-reaction' || event.targetId === undefined) continue;
      const entity = this.entitiesById.get(event.targetId);
      if (!entity || entity.building) continue;
      let dirX = event.impulseX ?? event.toX - event.fromX;
      let dirZ = event.impulseZ ?? event.toZ - event.fromZ;
      const distance = Math.hypot(dirX, dirZ);
      if (distance > 0.001) {
        dirX /= distance;
        dirZ /= distance;
      } else {
        dirX = -Math.sin(entity.transform.rot);
        dirZ = -Math.cos(entity.transform.rot);
      }
      const force = Math.max(0.025, Math.min(1, event.force ?? event.damage / Math.max(1, event.targetMaxHealth ?? event.damage)));
      const isInfantry = entity.selectable?.type === 'infantry';
      const isAircraft = Boolean(entity.flight);
      const profile = impactReactionProfile(force, event.impactKind, unitVisualKind(entity), event.killed);
      const duration = isAircraft ? Math.max(profile.duration, 0.62 + force * 0.82) : profile.duration;
      const existing = this.hitReactions.get(entity);
      const forwardX = Math.sin(entity.transform.rot);
      const forwardZ = Math.cos(entity.transform.rot);
      const rightX = Math.cos(entity.transform.rot);
      const rightZ = -Math.sin(entity.transform.rot);
      const localSide = dirX * rightX + dirZ * rightZ;
      const localForward = dirX * forwardX + dirZ * forwardZ;
      const hitCount = Math.min(4, (existing?.hitCount ?? 0) + 1);
      const salvoBoost = 1 + (hitCount - 1) * 0.16;
      this.hitReactions.set(entity, {
        elapsed: 0,
        duration: Math.min(1.65, Math.max(duration, existing?.duration ?? 0) * salvoBoost),
        force: Math.min(1.35, force + (existing?.force ?? 0) * 0.38),
        shove: Math.min(4.6, Math.max(profile.shove, (existing?.shove ?? 0) * 0.78) * salvoBoost),
        lift: Math.min(2.8, Math.max(profile.lift, event.verticalImpulse ?? 0, (existing?.lift ?? 0) * 0.76) * salvoBoost),
        angular: Math.min(1.55, Math.max(profile.angular, Math.abs(event.angularImpulse ?? 0), (existing?.angular ?? 0) * 0.76) * salvoBoost),
        dirX,
        dirZ,
        localSide,
        localForward,
        sign: localSide >= 0 ? 1 : -1,
        zone: event.impactZone ?? (Math.abs(localSide) > Math.abs(localForward) ? (localSide >= 0 ? 'left' : 'right') : (localForward >= 0 ? 'rear' : 'front')),
        topFactor: event.topFactor ?? (event.trajectory === 'drop' ? 0.9 : 0.08),
        hitCount,
        intensity: Math.min(1.6, profile.intensity + (existing?.intensity ?? 0) * 0.3),
        killed: event.killed,
      });
      if (event.killed && !entity.flight && entity.selectable?.type !== 'infantry') {
        const rest = groundVehicleImpactPose({
          progress: 1,
          force,
          intensity: profile.intensity,
          zone: event.impactZone ?? (Math.abs(localSide) > Math.abs(localForward) ? (localSide >= 0 ? 'left' : 'right') : (localForward >= 0 ? 'rear' : 'front')),
          localSide,
          localForward,
          killed: true,
        });
        this.wreckTilts.set(entity, { pitch: rest.pitch, roll: rest.roll });
      }
    }
  }

  setVisualQuality(tier: VisualQualityTier): void {
    if (this.visualQuality === tier) return;
    this.visualQuality = tier;
    const proxiesVisible = tier >= 2;
    for (const meshes of Object.values(this.lowDetailMeshes)) {
      for (const proxy of Object.values(meshes)) {
        proxy.body.visible = proxiesVisible;
        proxy.color.visible = proxiesVisible;
        proxy.detail.visible = proxiesVisible;
      }
    }
    this.friendlyGlow.mesh.visible = !proxiesVisible;
    this.bikeDustMesh.visible = !proxiesVisible;
    if (proxiesVisible) {
      this.bikeDustParticles.length = 0;
      this.bikeDustMesh.count = 0;
    }
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
    this.visualFrame++;
    if (this.visualQuality >= 2) {
      this.updateLowDetail(alpha, dt, camera);
      return;
    }
    const detailInterval = this.visualQuality === 0 ? 1 : 2;
    const updateDetails = this.visualFrame % detailInterval === 0;
    if (updateDetails) this.friendlyGlow.count = 0;
    const glowTime = performance.now() * 0.0026;
    for (const entity of this.entities) {
      const obj = this.objects.get(entity);
      const ring = this.selectedRings.get(entity);
      if (!obj || !ring) continue;
      const gone = entity === this.hiddenEntity;
      const fogged = entity.team?.id !== this.localTeam && !this.isVisible(entity.transform.x, entity.transform.z);
      if (gone || fogged) {
        obj.visible = false;
        ring.visible = false;
        const shadow = this.airShadows.get(entity);
        if (shadow) shadow.visible = false;
        const wash = this.rotorWashes.get(entity);
        if (wash) wash.mesh.visible = false;
        const healthBar = this.healthBars.get(entity);
        if (healthBar) healthBar.root.visible = false;
        const rankBadge = this.rankBadges.get(entity);
        if (rankBadge) rankBadge.root.visible = false;
        continue;
      }
      obj.visible = true;
      this.updateUpgradeVisuals(entity);
      const x = lerp(entity.previousTransform.x, entity.transform.x, alpha);
      const z = lerp(entity.previousTransform.z, entity.transform.z, alpha);
      const rot = lerpAngle(entity.previousTransform.rot, entity.transform.rot, alpha);
      const groundY = sampleHeight(this.hf, x, z);
      let y = entity.flight ? lerp(entity.previousTransform.y ?? entity.transform.y ?? groundY, entity.transform.y ?? groundY, alpha) : groundY + 0.35;
      if (this.isGroundVehicle(entity)) {
        // Terrain pitch and roll are chassis-local. YXZ applies heading first,
        // so turning on a hillside cannot rotate an uphill pitch around a
        // world-space axis and tip the tank onto its edge.
        obj.rotation.order = 'YXZ';
        const attitude = this.updateGroundAttitude(entity, x, z, rot, dt);
        y = attitude.y + 0.35;
      }
      obj.position.set(x, y, z);
      obj.rotation.y = rot;
      if (updateDetails && !entity.destroyed) this.updateFriendlyGlow(entity, x, y, z, glowTime);
      this.applyPose(entity, obj, dt);
      this.applyHitReaction(entity, obj, dt);
      if (updateDetails) this.updateUnitDamage(entity);
      const turret = this.refs.get(entity)?.turretPivot;
      if (turret && entity.turret && !entity.destroyed) turret.rotation.y = entity.turret.yaw - rot;
      ring.position.set(x, groundY + 0.08, z);
      const selected = this.selectionOverlayVisible && !entity.destroyed && (entity.selectable?.selected ?? false);
      ring.visible = selected;
      if (selected) {
        if (updateDetails) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008 + entity.id);
          ring.scale.setScalar(1 + pulse * 0.075);
        }
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
        if (!updateDetails) continue;
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
      if (updateDetails) {
        this.updateHealthBar(entity, x, y, z, camera);
        this.updateRankBadge(entity, x, y, z, camera);
      }
    }
    if (updateDetails) {
      this.friendlyGlow.mesh.count = this.friendlyGlow.count;
      this.friendlyGlow.mesh.instanceMatrix.needsUpdate = true;
      this.updateBikeDust(dt * detailInterval);
    }
  }

  private updateLowDetail(alpha: number, dt: number, camera: Camera): void {
    for (const meshes of Object.values(this.lowDetailMeshes)) {
      for (const proxy of Object.values(meshes)) proxy.count = 0;
    }
    for (const entity of this.entities) {
      const obj = this.objects.get(entity);
      const ring = this.selectedRings.get(entity);
      if (!obj || !ring) continue;
      obj.visible = false;
      const shadow = this.airShadows.get(entity);
      if (shadow) shadow.visible = false;
      const wash = this.rotorWashes.get(entity);
      if (wash) wash.mesh.visible = false;
      const gone = entity === this.hiddenEntity;
      const fogged = entity.team?.id !== this.localTeam && !this.isVisible(entity.transform.x, entity.transform.z);
      if (gone || fogged) {
        ring.visible = false;
        const healthBar = this.healthBars.get(entity);
        if (healthBar) healthBar.root.visible = false;
        const rankBadge = this.rankBadges.get(entity);
        if (rankBadge) rankBadge.root.visible = false;
        continue;
      }
      const x = lerp(entity.previousTransform.x, entity.transform.x, alpha);
      const z = lerp(entity.previousTransform.z, entity.transform.z, alpha);
      const rot = lerpAngle(entity.previousTransform.rot, entity.transform.rot, alpha);
      const groundY = sampleHeight(this.hf, x, z);
      let y = entity.flight
        ? lerp(entity.previousTransform.y ?? entity.transform.y ?? groundY, entity.transform.y ?? groundY, alpha)
        : groundY + 0.35;
      const terrainAttitude = this.isGroundVehicle(entity)
        ? this.updateGroundAttitude(entity, x, z, rot, dt)
        : undefined;
      if (terrainAttitude) y = terrainAttitude.y + 0.35;
      const dx = x - camera.position.x;
      const dy = y - camera.position.y;
      const dz = z - camera.position.z;
      const resolvedByFortressOptics =
        this.fortressOpticsActive &&
        Boolean(entity.flight) &&
        entity.team?.id !== this.localTeam &&
        dx * dx + dy * dy + dz * dz <= FORTRESS_OPTICS_DETAIL_RANGE_SQ;
      const crashingAircraft =
        entity.flight !== undefined &&
        entity.destroyed !== undefined &&
        entity.destroyed.aircraftCrash?.impacted !== true;
      const selected = entity.selectable?.selected ?? false;
      const keepDetailed = shouldKeepDetailedUnitInPerformanceMode({
        distanceSquared: dx * dx + dy * dy + dz * dz,
        selected,
        playerControlled: Boolean(entity.playerControlled),
        priority: entity === this.priorityDetailedEntity,
        resolvedByFortressOptics,
        crashingAircraft,
        destroyed: Boolean(entity.destroyed),
      });
      if (keepDetailed) {
        obj.visible = true;
        this.updateUpgradeVisuals(entity);
        obj.position.set(x, y, z);
        if (terrainAttitude) obj.rotation.order = 'YXZ';
        obj.rotation.y = rot;
        this.applyPose(entity, obj, dt);
        this.applyHitReaction(entity, obj, dt);
        this.updateUnitDamage(entity);
        const turret = this.refs.get(entity)?.turretPivot;
        if (turret && entity.turret) turret.rotation.y = entity.turret.yaw - rot;
      } else {
        this.addLowDetailInstance(entity, x, y, z, rot, terrainAttitude);
      }
      ring.position.set(x, groundY + 0.08, z);
      ring.visible = this.selectionOverlayVisible && !entity.destroyed && selected;
      ring.scale.setScalar(1);
      this.updateHealthBar(entity, x, y, z, camera, true);
      this.updateRankBadge(entity, x, y, z, camera, true);
    }
    for (const meshes of Object.values(this.lowDetailMeshes)) {
      for (const proxy of Object.values(meshes)) {
        proxy.body.count = proxy.count;
        proxy.color.count = proxy.count;
        proxy.detail.count = proxy.count;
        proxy.body.instanceMatrix.needsUpdate = true;
        proxy.color.instanceMatrix.needsUpdate = true;
        proxy.detail.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private addLowDetailInstance(
    entity: Entity,
    x: number,
    y: number,
    z: number,
    rot: number,
    terrainAttitude?: GroundVehicleTerrainAttitude,
  ): void {
    const kind: LowDetailKind = entity.flight ? 'aircraft' : entity.selectable?.type === 'infantry' ? 'infantry' : 'vehicle';
    const proxy = this.lowDetailMeshes[factionId(entity.team?.id)][kind];
    if (proxy.count >= MAX_LOW_DETAIL_UNITS) return;
    const radius = Math.max(0.65, entity.selectable?.radius ?? 1.5);
    const destroyedScale = entity.destroyed ? 0.32 : 1;
    this.lowDetailTransform.position.set(x, y + (kind === 'infantry' ? 0.85 : kind === 'vehicle' ? 0.62 : 0), z);
    this.lowDetailTransform.rotation.set(
      terrainAttitude?.pitch ?? 0,
      rot,
      (terrainAttitude?.roll ?? 0) + (entity.destroyed ? Math.PI * 0.38 : 0),
      terrainAttitude ? 'YXZ' : 'XYZ',
    );
    if (kind === 'infantry') this.lowDetailTransform.scale.set(0.78, 1.75 * destroyedScale, 0.78);
    else if (kind === 'aircraft') this.lowDetailTransform.scale.set(radius * 1.55, 0.75 * destroyedScale, radius * 1.15);
    else this.lowDetailTransform.scale.set(radius * 1.35, Math.max(0.55, radius * 0.58) * destroyedScale, radius * 1.75);
    this.lowDetailTransform.updateMatrix();
    proxy.body.setMatrixAt(proxy.count, this.lowDetailTransform.matrix);
    proxy.color.setMatrixAt(proxy.count, this.lowDetailTransform.matrix);
    proxy.detail.setMatrixAt(proxy.count, this.lowDetailTransform.matrix);
    proxy.count++;
  }

  private updateFriendlyGlow(entity: Entity, x: number, y: number, z: number, time: number): void {
    if (factionId(entity.team?.id) !== factionId(this.localTeam) || this.friendlyGlow.count >= MAX_FRIENDLY_GLOWS) return;
    const type = entity.selectable?.type;
    const pulse = 0.5 + 0.5 * Math.sin(time + entity.id * 0.71);
    const breathe = 0.96 + pulse * 0.12;
    const radius = type === 'infantry' ? 1.05 : entity.flight ? 4.25 : type === 'harvester' ? 3.25 : 2.75;
    const height = type === 'infantry' ? 1.55 : entity.flight ? 1.85 : 1.45;
    this.glowTransform.position.set(x, y + (type === 'infantry' ? 1.1 : entity.flight ? 0.1 : 1.15), z);
    this.glowTransform.rotation.set(0, 0, 0);
    this.glowTransform.scale.set(radius * breathe, height * breathe, radius * breathe);
    this.glowTransform.updateMatrix();
    this.friendlyGlow.mesh.setMatrixAt(this.friendlyGlow.count, this.glowTransform.matrix);
    this.friendlyGlow.count++;
  }

  private updateUpgradeVisuals(entity: Entity): void {
    for (const [upgradeId, visual] of this.refs.get(entity)?.upgradeVisuals ?? []) {
      visual.visible = hasUnitUpgrade(entity, upgradeId);
    }
  }

  private isGroundVehicle(entity: Entity): boolean {
    const type = entity.selectable?.type;
    return !entity.flight && (type === 'tank' || type === 'harvester' || (type === 'infantry' && hasUnitUpgrade(entity, 'combat-bike')));
  }

  private updateGroundAttitude(entity: Entity, x: number, z: number, yaw: number, dt: number): GroundVehicleTerrainAttitude {
    const target = groundVehicleTerrainAttitude(
      this.hf,
      x,
      z,
      yaw,
      entity.mover?.radius ?? entity.selectable?.radius ?? 1.8,
    );
    const current = this.groundAttitudes.get(entity);
    if (!current) {
      this.groundAttitudes.set(entity, target);
      return target;
    }
    const tiltBlend = 1 - Math.exp(-Math.max(0, dt) * 24);
    current.pitch += (target.pitch - current.pitch) * tiltBlend;
    current.roll += (target.roll - current.roll) * tiltBlend;
    // Clearance follows the footprint directly. The previous error-based lift
    // interpreted a fast yaw turn as a sudden suspension impact, which made
    // V-mode tanks jump and pivot around one track on steep terrain.
    current.y = target.y;
    return current;
  }

  private applyHitReaction(entity: Entity, obj: Object3D, dt: number): void {
    const reaction = this.hitReactions.get(entity);
    if (!reaction) return;
    reaction.elapsed += dt;
    const t = Math.min(1, reaction.elapsed / reaction.duration);
    const arc = Math.sin(t * Math.PI);
    const { localSide, localForward } = reaction;
    if (entity.selectable?.type === 'infantry') {
      const pose = infantryImpactPose(t, reaction.intensity, localSide, localForward, reaction.killed);
      obj.rotation.x += pose.pitch;
      obj.rotation.z += pose.roll;
      obj.position.y += pose.lift;
      obj.position.x += reaction.dirX * pose.shove * reaction.shove;
      obj.position.z += reaction.dirZ * pose.shove * reaction.shove;
      const rig = this.soldierRigs.get(entity);
      if (rig && pose.limbBlend > 0.001) {
        const ground = pose.grounded;
        const brace = pose.brace;
        const crouch = pose.crouch;
        const blend = pose.limbBlend;
        const targetHipL = ground * 0.48 - brace * 0.84 - crouch * 0.28;
        const targetHipR = ground * -0.18 - brace * 0.34 - crouch * 0.22;
        const targetKneeL = ground * 0.72 + brace * 1.32 + crouch * 0.42;
        const targetKneeR = ground * 0.38 + brace * 0.88 + crouch * 0.36;
        rig.hipL.rotation.x = lerp(rig.hipL.rotation.x, targetHipL, blend);
        rig.hipR.rotation.x = lerp(rig.hipR.rotation.x, targetHipR, blend);
        rig.kneeL.rotation.x = lerp(rig.kneeL.rotation.x, targetKneeL, blend);
        rig.kneeR.rotation.x = lerp(rig.kneeR.rotation.x, targetKneeR, blend);
        rig.shoulderL.rotation.x = lerp(rig.shoulderL.rotation.x, ground * -0.18 + brace * -1.18 + crouch * -0.82, blend);
        rig.shoulderR.rotation.x = lerp(rig.shoulderR.rotation.x, ground * 0.28 + brace * -1.02 + crouch * -0.74, blend);
        rig.elbowL.rotation.x = lerp(rig.elbowL.rotation.x, ground * -0.3 + brace * -0.92 + crouch * -0.56, blend);
        rig.elbowR.rotation.x = lerp(rig.elbowR.rotation.x, ground * 0.42 + brace * -0.68 + crouch * -0.48, blend);
        rig.torso.rotation.x = lerp(rig.torso.rotation.x, ground * 0.08 + brace * 0.52 + crouch * 0.24, blend);
        rig.rifle.position.y -= (ground * 0.18 + brace * 0.11) * blend;
        rig.rifle.rotation.x += (ground * 0.24 - brace * 0.18) * blend;
      }
    } else if (entity.flight) {
      obj.rotation.x += -localForward * (0.12 + reaction.force * 0.72) * arc;
      obj.rotation.z += reaction.sign * (0.18 + reaction.force * 1.35) * arc;
      obj.position.y += -arc * reaction.force * 1.8 + Math.sin(t * Math.PI * 2) * reaction.force * 0.32;
      obj.position.x += reaction.dirX * arc * reaction.force * 1.1;
      obj.position.z += reaction.dirZ * arc * reaction.force * 1.1;
    } else {
      const pose = groundVehicleImpactPose({
        progress: t,
        force: reaction.force,
        intensity: reaction.intensity,
        zone: reaction.zone,
        localSide,
        localForward,
        killed: reaction.killed,
      });
      obj.rotation.x += pose.pitch;
      obj.rotation.z += pose.roll;
      obj.position.y += pose.lift;
      obj.position.x += reaction.dirX * pose.shove * Math.min(0.85, reaction.shove);
      obj.position.z += reaction.dirZ * pose.shove * Math.min(0.85, reaction.shove);
      if (t >= 1 && reaction.killed) this.wreckTilts.set(entity, { pitch: pose.pitch, roll: pose.roll });
    }
    if (t >= 1) this.hitReactions.delete(entity);
  }

  /** Walk cycles, death poses, and wreck states — all driven by sim data. */
  private applyPose(entity: Entity, obj: Object3D, dt: number): void {
    const isInfantry = entity.selectable?.type === 'infantry';
    const refs = this.refs.get(entity);
    if (entity.destroyed) {
      if (entity.flight) {
        const crash = entity.destroyed.aircraftCrash;
        const pitch = lerp(entity.flight.previousPitchAttitude, entity.flight.pitchAttitude, 0.65);
        const roll = lerp(entity.flight.previousRollAttitude, entity.flight.rollAttitude, 0.65);
        obj.rotation.x = pitch + (crash?.impacted ? 0.2 : 0);
        obj.rotation.z = -roll;
        const sinceDeath = Math.max(0, 20 - entity.destroyed.remaining);
        const rotorSpeed = crash?.impacted ? 0 : Math.max(2.4, 17 - sinceDeath * 4.2);
        for (const mainRotor of refs?.mainRotors ?? []) {
          mainRotor.rotation.x = -pitch * 0.42;
          mainRotor.rotation.z = roll * 0.42;
          mainRotor.rotation.y += dt * rotorSpeed;
        }
        for (const tailRotor of refs?.tailRotors ?? []) tailRotor.rotation.x += dt * rotorSpeed * 1.35;
        if (crash?.impacted && !this.wrecked.has(entity)) {
          this.wrecked.add(entity);
          obj.traverse((child) => {
            if (child instanceof Mesh) child.material = this.wreckMaterial;
          });
        }
        return;
      }
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
      } else {
        // tanks become scorched husks that persist
        if (!this.wrecked.has(entity)) {
          this.wrecked.add(entity);
          obj.traverse((child) => {
            if (child instanceof Mesh) child.material = this.wreckMaterial;
          });
          const turret = refs?.turretPivot;
          if (turret) {
            turret.rotation.x = 0.14;
            turret.position.y = -0.12;
          }
        }
        const terrain = this.groundAttitudes.get(entity);
        const liveHit = this.hitReactions.get(entity);
        if (liveHit) {
          obj.rotation.x = terrain?.pitch ?? 0;
          obj.rotation.z = terrain?.roll ?? 0;
        } else {
          const wreck = this.wreckTilts.get(entity);
          obj.rotation.x = (terrain?.pitch ?? 0) + (wreck?.pitch ?? 0.1);
          obj.rotation.z = (terrain?.roll ?? 0) + (wreck?.roll ?? 0.12);
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
      const terrain = this.groundAttitudes.get(entity);
      obj.rotation.x = terrain?.pitch ?? 0;
      obj.rotation.z = terrain?.roll ?? 0;
      const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
      const maxSpeed = Math.max(1, entity.mover?.speed ?? 12);
      const speedT = Math.min(1, speed / maxSpeed);
      if (refs?.groundDrive) {
        const moveYaw = speed > 0.4 && entity.velocity
          ? Math.atan2(entity.velocity.x, entity.velocity.z)
          : entity.transform.rot;
        const slip = Math.atan2(Math.sin(moveYaw - entity.transform.rot), Math.cos(moveYaw - entity.transform.rot));
        obj.rotation.x += Math.sin(performance.now() * 0.0075 + entity.id * 0.7) * 0.009 * speedT;
        obj.rotation.z += Math.max(-0.055, Math.min(0.055, -slip * 0.1));
        obj.position.y += Math.sin(performance.now() * 0.011 + entity.id) * 0.018 * speedT;
        this.emitTankDust(entity, speed, dt);
      }
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
        const workingPulse = Math.sin(performance.now() * 0.012 + entity.id);
        scoop.rotation.x += ((gathering ? -0.16 + workingPulse * 0.035 : 0.04) - scoop.rotation.x) * Math.min(1, dt * 5);
        if (refs.harvestingRotor) {
          refs.harvestingRotor.rotation.x += dt * (gathering ? 7.5 : speedT * 1.6);
        }
        for (const roller of refs.conveyorRollers ?? []) {
          roller.rotation.x += dt * (gathering ? 9 : speedT * 0.8);
        }
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
      if (refs?.antenna) {
        refs.antenna.rotation.z = Math.sin(performance.now() * (0.0065 + speedT * 0.003) + entity.id) * (0.05 + speedT * 0.055);
      }
      return;
    }

    if (!isInfantry) {
      const terrain = this.groundAttitudes.get(entity);
      obj.rotation.x = terrain?.pitch ?? 0;
      obj.rotation.z = terrain?.roll ?? 0;
      const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
      const maxSpeed = Math.max(1, entity.mover?.speed ?? 12);
      const speedT = Math.min(1, speed / maxSpeed);
      if (refs?.groundDrive) {
        const moveYaw = speed > 0.4 && entity.velocity
          ? Math.atan2(entity.velocity.x, entity.velocity.z)
          : entity.transform.rot;
        const slip = Math.atan2(Math.sin(moveYaw - entity.transform.rot), Math.cos(moveYaw - entity.transform.rot));
        obj.rotation.x += Math.sin(performance.now() * 0.009 + entity.id * 0.7) * 0.012 * speedT;
        obj.rotation.z += Math.max(-0.075, Math.min(0.075, -slip * 0.13));
        obj.position.y += Math.sin(performance.now() * 0.014 + entity.id) * 0.025 * speedT;
        this.emitTankDust(entity, speed, dt);
      }
      if (refs?.antenna) {
        const vibration = 0.04 + speedT * 0.07;
        refs.antenna.rotation.z = Math.sin(performance.now() * (0.007 + speedT * 0.004) + entity.id) * vibration;
      }
      const primaryCooldown = entity.weapons?.primary.cooldown ?? entity.weapon?.cooldown ?? 0;
      if (refs) {
        const previousCooldown = refs.lastPrimaryCooldown ?? primaryCooldown;
        if (primaryCooldown > previousCooldown + 0.08) refs.recoil = 1;
        refs.lastPrimaryCooldown = primaryCooldown;
        refs.recoil = Math.max(0, (refs.recoil ?? 0) - dt * 4.8);
      }
      const recoil = refs?.recoil ?? 0;
      const recoilKick = Math.sin(Math.min(1, (1 - recoil) * 2.4) * Math.PI) * recoil;
      if (refs?.barrelPivot && refs.barrelHomeZ !== undefined) {
        refs.barrelPivot.position.z = refs.barrelHomeZ - recoilKick * 0.46;
      }
      if (refs?.muzzleFlash) {
        refs.muzzleFlash.visible = recoil > 0.62;
        refs.muzzleFlash.scale.set(0.75 + recoil * 0.6, 0.75 + recoil * 0.6, 0.8 + recoil * 1.15);
        refs.muzzleFlash.rotation.z += dt * 8;
      }
      if (refs?.barrelPivot && entity.weapons?.secondary?.cooldown && entity.weapons.secondary.cooldown > 0) {
        refs.barrelPivot.rotation.x = -0.16;
      } else if (refs?.barrelPivot) {
        refs.barrelPivot.rotation.x += (0 - refs.barrelPivot.rotation.x) * Math.min(1, dt * 7);
      }
      this.updateEscortDrone(entity, refs, dt);
      return;
    }

    const rig = this.soldierRigs.get(entity);
    const anim = this.anims.get(entity);
    if (!rig || !anim) return;
    const bikeTerrain = hasUnitUpgrade(entity, 'combat-bike') ? this.groundAttitudes.get(entity) : undefined;
    obj.rotation.x = bikeTerrain?.pitch ?? 0;
    obj.rotation.z = bikeTerrain?.roll ?? 0;
    const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
    const onCombatBike = hasUnitUpgrade(entity, 'combat-bike');
    rig.combatBike.visible = onCombatBike;
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
    if (onCombatBike) {
      rig.hipL.rotation.x = -0.72;
      rig.hipR.rotation.x = -0.72;
      rig.kneeL.rotation.x = 1.2;
      rig.kneeR.rotation.x = 1.2;
      for (const wheel of rig.bikeWheels) wheel.rotation.x -= (speed / 0.43) * dt;
      const headingStep = Math.atan2(
        Math.sin(entity.transform.rot - entity.previousTransform.rot),
        Math.cos(entity.transform.rot - entity.previousTransform.rot),
      );
      const speedWeight = 0.16 + speedT * 0.84;
      const leanTarget = Math.max(-0.48, Math.min(0.48, -headingStep * (4.5 + speedT * 10.5) * speedWeight));
      const steerTarget = Math.max(-0.58, Math.min(0.58, headingStep * (15 - speedT * 4)));
      const acceleration = speed - anim.bikeSpeed;
      const pitchTarget = Math.max(-0.14, Math.min(0.16, -acceleration * 0.035));
      const leanResponse = Math.abs(leanTarget) > Math.abs(anim.bikeLean) ? 9.5 : 4.2;
      anim.bikeLean += (leanTarget - anim.bikeLean) * Math.min(1, dt * leanResponse);
      anim.bikeSteer += (steerTarget - anim.bikeSteer) * Math.min(1, dt * 11);
      anim.bikePitch += (pitchTarget - anim.bikePitch) * Math.min(1, dt * 6.5);
      anim.bikeSpeed += (speed - anim.bikeSpeed) * Math.min(1, dt * 4.5);
      // Lean the complete rider/bike assembly; leaning only the wheels made the
      // rider appear unnaturally locked upright during high-speed turns.
      obj.rotation.z += anim.bikeLean;
      rig.combatBike.rotation.z = 0;
      rig.bikeSteering.rotation.y = anim.bikeSteer;
      rig.bikeSteering.rotation.z = -anim.bikeSteer * 0.08;
      const roadPulse = Math.sin(anim.phase * 1.7) * (0.012 + speedT * 0.025);
      const cornerCompression = Math.abs(anim.bikeLean) * 0.055;
      rig.combatBike.position.y = roadPulse - cornerCompression;
      rig.bikeSteering.position.y = Math.max(-0.09, -anim.bikePitch * 0.42);
      this.emitBikeDust(entity, speed, dt);
    } else {
      anim.bikeLean += (0 - anim.bikeLean) * Math.min(1, dt * 8);
      anim.bikeSteer += (0 - anim.bikeSteer) * Math.min(1, dt * 10);
      anim.bikePitch += (0 - anim.bikePitch) * Math.min(1, dt * 7);
      anim.bikeSpeed += (0 - anim.bikeSpeed) * Math.min(1, dt * 5);
      rig.combatBike.rotation.z += (0 - rig.combatBike.rotation.z) * Math.min(1, dt * 8);
      rig.bikeSteering.rotation.y += (0 - rig.bikeSteering.rotation.y) * Math.min(1, dt * 10);
      rig.bikeSteering.rotation.z += (0 - rig.bikeSteering.rotation.z) * Math.min(1, dt * 10);
      rig.bikeSteering.position.y += (0 - rig.bikeSteering.position.y) * Math.min(1, dt * 8);
      rig.combatBike.position.y = 0;
      this.bikeDustSpawn.delete(entity);
    }
    // gait bob + a touch of forward lean when running
    obj.position.y += onCombatBike ? 0.34 : (Math.abs(Math.sin(anim.phase * 2)) * 0.05 - 0.02) * anim.swing - anim.crouch * 0.12 - rocketKneel * 0.08;
    rig.root.rotation.x = onCombatBike ? -0.08 + anim.bikePitch : 0.04 + 0.1 * speedT * anim.swing - anim.crouch * 0.05;
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

  private updateEscortDrone(entity: Entity, refs: UnitRefs | undefined, dt: number): void {
    const drone = refs?.escortDrone;
    const state = entity.unitUpgrades?.escortDrone;
    if (!drone || !state || !hasUnitUpgrade(entity, 'reactive-plating')) return;
    const orbit = escortDroneLocalPosition(state.orbitAngle);
    drone.position.set(orbit.x, orbit.y, orbit.z);
    const target = state.targetId === undefined ? undefined : this.entitiesById.get(state.targetId);
    if (target) {
      const worldBearing = Math.atan2(target.transform.x - entity.transform.x, target.transform.z - entity.transform.z);
      drone.rotation.y = worldBearing - entity.transform.rot;
    } else {
      drone.rotation.y = -state.orbitAngle + Math.PI * 0.5;
    }
    drone.rotation.x = Math.sin(state.orbitAngle * 2.4 + entity.id) * 0.08;
    drone.rotation.z = Math.cos(state.orbitAngle * 1.7 + entity.id) * 0.12;
    for (const rotor of refs?.escortDroneRotors ?? []) rotor.rotation.y += dt * 28;
  }

  private emitBikeDust(entity: Entity, speed: number, dt: number): void {
    if (speed < 7 || !entity.velocity) {
      this.bikeDustSpawn.set(entity, 0);
      return;
    }
    let pending = (this.bikeDustSpawn.get(entity) ?? 0) + dt * Math.min(14, 1.1 + speed * 0.34);
    const dirX = entity.velocity.x / speed;
    const dirZ = entity.velocity.z / speed;
    let emitted = 0;
    while (pending >= 1 && emitted < 3) {
      pending -= 1;
      emitted++;
      const seed = entity.id * 211 + this.bikeDustSerial++;
      const jitter = deterministicUnitSigned(seed, 0xd51);
      const side = deterministicUnitSigned(seed, 0xd73) * 0.48;
      const groundY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
      if (this.bikeDustParticles.length >= MAX_BIKE_DUST_PARTICLES) this.bikeDustParticles.shift();
      this.bikeDustParticles.push({
        x: entity.transform.x - dirX * 0.9 - dirZ * side,
        y: groundY + 0.28,
        z: entity.transform.z - dirZ * 0.9 + dirX * side,
        vx: -dirX * (1.1 + speed * 0.045) - dirZ * jitter * 0.7,
        vy: 0.65 + Math.abs(jitter) * 0.55,
        vz: -dirZ * (1.1 + speed * 0.045) + dirX * jitter * 0.7,
        age: 0,
        lifetime: 0.78 + Math.abs(deterministicUnitSigned(seed, 0xda1)) * 0.48,
        scale: 0.68 + Math.abs(deterministicUnitSigned(seed, 0xdc7)) * 0.46,
      });
    }
    this.bikeDustSpawn.set(entity, pending);
  }

  private emitTankDust(entity: Entity, speed: number, dt: number): void {
    if (speed < 2.5 || !entity.velocity) {
      this.bikeDustSpawn.set(entity, 0);
      return;
    }
    let pending = (this.bikeDustSpawn.get(entity) ?? 0) + dt * Math.min(18, 1.6 + speed * 0.48);
    const dirX = entity.velocity.x / speed;
    const dirZ = entity.velocity.z / speed;
    let emitted = 0;
    while (pending >= 1 && emitted < 4) {
      pending -= 1;
      emitted++;
      const seed = entity.id * 307 + this.bikeDustSerial++;
      const side = emitted % 2 === 0 ? -1 : 1;
      const jitter = deterministicUnitSigned(seed, 0xe51);
      const trackOffset = 1.72 * side;
      const groundY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
      if (this.bikeDustParticles.length >= MAX_BIKE_DUST_PARTICLES) this.bikeDustParticles.shift();
      this.bikeDustParticles.push({
        x: entity.transform.x - dirX * 2.1 - dirZ * trackOffset,
        y: groundY + 0.24,
        z: entity.transform.z - dirZ * 2.1 + dirX * trackOffset,
        vx: -dirX * (0.7 + speed * 0.035) - dirZ * jitter * 0.8,
        vy: 0.48 + Math.abs(jitter) * 0.52,
        vz: -dirZ * (0.7 + speed * 0.035) + dirX * jitter * 0.8,
        age: 0,
        lifetime: 0.9 + Math.abs(deterministicUnitSigned(seed, 0xea1)) * 0.65,
        scale: 0.92 + Math.abs(deterministicUnitSigned(seed, 0xec7)) * 0.68,
      });
    }
    this.bikeDustSpawn.set(entity, pending);
  }

  private updateBikeDust(dt: number): void {
    let count = 0;
    for (let i = this.bikeDustParticles.length - 1; i >= 0; i--) {
      const particle = this.bikeDustParticles[i];
      particle.age += dt;
      if (particle.age >= particle.lifetime) {
        this.bikeDustParticles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      particle.vx *= Math.max(0, 1 - dt * 1.8);
      particle.vz *= Math.max(0, 1 - dt * 1.8);
      particle.vy += dt * 0.18;
      const life = particle.age / particle.lifetime;
      const fade = Math.min(1, life * 7) * Math.max(0, 1 - life);
      const size = particle.scale * (0.28 + life * 1.75) * Math.sqrt(fade);
      this.bikeDustTransform.position.set(particle.x, particle.y, particle.z);
      this.bikeDustTransform.rotation.set(0, 0, 0);
      this.bikeDustTransform.scale.set(size * 1.35, size * 0.62, size);
      this.bikeDustTransform.updateMatrix();
      this.bikeDustMesh.setMatrixAt(count++, this.bikeDustTransform.matrix);
    }
    this.bikeDustMesh.count = count;
    this.bikeDustMesh.instanceMatrix.needsUpdate = true;
  }

  private updateUnitDamage(entity: Entity): void {
    const overlay = this.damageOverlays.get(entity);
    if (!overlay || !entity.health) return;
    const stage: UnitDamageStage = entity.destroyed ? 3 : unitDamageStage(entity.health.current, entity.health.max);
    overlay.root.visible = stage > 0;
    if (!overlay.root.visible) return;
    const time = performance.now() * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(time * 11 + entity.id);
    for (const patch of overlay.patches) {
      patch.mesh.visible = stage >= patch.stage;
      if (!patch.mesh.visible) continue;
      if (patch.kind === 'ember') patch.mesh.scale.setScalar(0.9 + pulse * 0.34 + stage * 0.08);
    }
    for (const effect of overlay.effects) {
      effect.mesh.visible = stage >= effect.stage;
      if (!effect.mesh.visible) continue;
      const wave = 0.5 + 0.5 * Math.sin(time * (effect.kind === 'smoke' ? 1.9 : 8.5) + effect.phase);
      if (effect.kind === 'smoke') {
        const drift = Math.sin(time * 1.15 + effect.phase) * effect.baseScale * 0.2;
        effect.mesh.position.set(
          effect.baseX + drift,
          effect.baseY + wave * effect.baseScale * 0.42,
          effect.baseZ + Math.cos(time * 0.92 + effect.phase) * effect.baseScale * 0.12,
        );
        effect.mesh.scale.set(
          effect.baseScale * (0.88 + wave * 0.3),
          effect.baseScale * (1.15 + wave * 0.52),
          effect.baseScale * (0.88 + wave * 0.3),
        );
      } else {
        effect.mesh.position.set(effect.baseX, effect.baseY + wave * 0.12, effect.baseZ);
        effect.mesh.scale.set(
          effect.baseScale * (0.72 + wave * 0.38),
          effect.baseScale * (1.05 + wave * 0.72),
          effect.baseScale * (0.72 + wave * 0.38),
        );
      }
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
    if (entity.team?.id !== this.localTeam && !this.isVisible(entity.transform.x, entity.transform.z)) return false;
    return true;
  }

  private updateHealthBar(entity: Entity, x: number, y: number, z: number, camera: Camera, compact = false): void {
    const healthBar = this.healthBars.get(entity);
    if (!healthBar || !entity.health) return;
    const pct = Math.max(0, Math.min(1, entity.health.current / entity.health.max));
    const selected = entity.selectable?.selected ?? false;
    const nearCamera = !compact || camera.position.distanceToSquared(this.lowDetailTransform.position.set(x, y, z)) < 90_000;
    healthBar.root.visible = !entity.destroyed && (compact
      ? (this.selectionOverlayVisible && selected) || (pct < 0.65 && nearCamera)
      : (this.selectionOverlayVisible && selected) || pct < 0.995);
    if (!healthBar.root.visible) return;
    const lift = unitChromeLift(entity);
    const rankVisible = (entity.combatRank?.rank ?? 0) > 0;
    healthBar.root.position.set(x, y + lift, z);
    healthBar.root.lookAt(camera.position);
    // Sit to the right of the rank disc when both are showing.
    healthBar.root.translateX(rankVisible ? 1.55 : 0);
    healthBar.fill.scale.x = Math.max(0.02, pct);
    healthBar.fill.position.x = -1.8 * (1 - pct);
    healthBar.fillMaterial.color.setHex(pct < 0.3 ? 0xff5142 : pct < 0.62 ? 0xffc04a : 0x79f06f);
  }

  private updateRankBadge(entity: Entity, x: number, y: number, z: number, camera: Camera, compact = false): void {
    const badge = this.rankBadges.get(entity);
    if (!badge) return;
    const rank = entity.combatRank?.rank ?? 0;
    if (rank <= 0 || entity.destroyed) {
      badge.root.visible = false;
      return;
    }
    // Always show earned ranks when near the camera — including low-detail army views.
    const nearCamera = camera.position.distanceToSquared(this.lowDetailTransform.position.set(x, y, z)) < (compact ? 220_000 : 420_000);
    badge.root.visible = nearCamera;
    if (!badge.root.visible) return;
    if (badge.rank !== rank) {
      badge.rank = rank;
      badge.material.map = rankChevronTexture(rank);
      badge.material.needsUpdate = true;
    }
    const healthBar = this.healthBars.get(entity);
    const healthVisible = !!healthBar?.root.visible;
    const lift = unitChromeLift(entity);
    const scale = compact ? 1.2 : 1.05;
    badge.root.scale.setScalar(scale);
    badge.root.position.set(x, y + lift, z);
    badge.root.lookAt(camera.position);
    // Sit to the left of the health bar (same height), or centered if HP chrome is hidden.
    badge.root.translateX(healthVisible ? -2.55 : 0);
  }
}

function unitChromeLift(entity: Entity): number {
  if (entity.selectable?.type === 'infantry') return 2.85;
  if (entity.selectable?.type === 'vulture') return 3.45;
  return 5.15;
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

const RANK_BADGE_GEOM = new PlaneGeometry(2.2, 2.2);
const rankTextures = new Map<number, CanvasTexture>();

function rankChevronTexture(rank: number): CanvasTexture {
  const clamped = Math.max(1, Math.min(3, Math.floor(rank)));
  const cached = rankTextures.get(clamped);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Dark disc so chevrons read clearly over busy terrain / unit meshes.
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8, 12, 10, 0.92)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = clamped >= 3 ? '#f4d56a' : '#d2b15f';
  ctx.stroke();

  const color = clamped >= 3 ? '#f7e08a' : '#e8c85a';
  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const startY = clamped === 1 ? 52 : clamped === 2 ? 40 : 30;
  for (let i = 0; i < clamped; i++) {
    const y = startY + i * 22;
    ctx.beginPath();
    ctx.moveTo(28, y + 16);
    ctx.lineTo(64, y);
    ctx.lineTo(100, y + 16);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  rankTextures.set(clamped, texture);
  return texture;
}

function createRankBadge(): { root: Group; material: MeshBasicMaterial; rank: number } {
  const root = new Group();
  root.visible = false;
  const material = new MeshBasicMaterial({
    map: rankChevronTexture(1),
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: DoubleSide,
  });
  const plane = new Mesh(RANK_BADGE_GEOM, material);
  plane.renderOrder = 44;
  root.add(plane);
  return { root, material, rank: 0 };
}

function createUnitDamageOverlay(
  entity: Entity,
  kind: UnitVisualKind,
  scorch: Material,
  crack: Material,
  ember: Material,
  smoke: Material,
): UnitDamageOverlay {
  const root = new Group();
  root.visible = false;
  const patches: UnitDamagePatch[] = [];
  const effects: UnitDamageEffect[] = [];
  const isAircraft = kind === 'wasp' || kind === 'vulture' || kind === 'hammerhead';
  const isHarvester = kind === 'harvester';
  const topY = isAircraft ? 0.92 : isHarvester ? 2.22 : kind === 'mauler' ? 1.2 : 1.28;
  const spanX = isAircraft ? (kind === 'hammerhead' ? 3.0 : 1.45) : isHarvester ? 2.25 : kind === 'mauler' ? 1.9 : 1.65;
  const spanZ = isAircraft ? (kind === 'wasp' ? 2.25 : kind === 'hammerhead' ? 2.4 : 2.85) : isHarvester ? 2.55 : kind === 'mauler' ? 3.25 : 2.35;
  const scorchStages: UnitDamageStage[] = [1, 1, 2, 2, 3, 3];
  const crackStages: UnitDamageStage[] = [1, 2, 2, 3, 3];
  const emberStages: UnitDamageStage[] = [3, 3, 3];

  for (let i = 0; i < scorchStages.length; i++) {
    const mesh = new Mesh(sharedBoxGeometry(1, 0.035, 1), scorch);
    const px = deterministicUnitSigned(entity.id, 0x110 + i) * spanX;
    const pz = deterministicUnitSigned(entity.id, 0x210 + i) * spanZ;
    mesh.position.set(px, topY + i * 0.008, pz);
    mesh.rotation.y = deterministicUnit(entity.id, 0x310 + i) * Math.PI;
    mesh.scale.set(0.9 + deterministicUnit(entity.id, 0x410 + i) * 0.75, 1, 0.5 + deterministicUnit(entity.id, 0x510 + i) * 0.52);
    mesh.renderOrder = 34;
    root.add(mesh);
    patches.push({ mesh, stage: scorchStages[i], kind: 'scorch' });
  }

  for (let i = 0; i < crackStages.length; i++) {
    const mesh = new Mesh(sharedBoxGeometry(1.1, 0.045, 0.08), crack);
    const px = deterministicUnitSigned(entity.id, 0x610 + i) * spanX * 0.92;
    const pz = deterministicUnitSigned(entity.id, 0x710 + i) * spanZ * 0.92;
    mesh.position.set(px, topY + 0.05 + i * 0.01, pz);
    mesh.rotation.y = deterministicUnit(entity.id, 0x810 + i) * Math.PI;
    mesh.scale.set(0.85 + deterministicUnit(entity.id, 0x910 + i) * 0.75, 1, 1);
    mesh.renderOrder = 35;
    root.add(mesh);
    patches.push({ mesh, stage: crackStages[i], kind: 'crack' });
  }

  for (let i = 0; i < emberStages.length; i++) {
    const mesh = new Mesh(sharedBoxGeometry(0.34, 0.04, 0.34), ember);
    const px = deterministicUnitSigned(entity.id, 0xa10 + i) * spanX * 0.78;
    const pz = deterministicUnitSigned(entity.id, 0xb10 + i) * spanZ * 0.78;
    mesh.position.set(px, topY + 0.09 + i * 0.012, pz);
    mesh.renderOrder = 36;
    root.add(mesh);
    patches.push({ mesh, stage: emberStages[i], kind: 'ember' });
  }

  // Smoke begins at the 50% state. Critical units reveal the full plume and
  // a compact engine fire. These meshes stay attached while units move.
  const engineX = deterministicUnitSigned(entity.id, 0xc10) * spanX * (isAircraft ? 0.42 : 0.58);
  const engineZ = isAircraft
    ? deterministicUnitSigned(entity.id, 0xc20) * spanZ * 0.35
    : -spanZ * 0.5;
  for (let i = 0; i < 4; i++) {
    const mesh = new Mesh(UNIT_DAMAGE_SMOKE_GEOM, smoke);
    const stage: UnitDamageStage = i < 2 ? 2 : 3;
    const baseScale = (isAircraft ? 0.42 : 0.5) + i * (isAircraft ? 0.1 : 0.12);
    const baseX = engineX + deterministicUnitSigned(entity.id, 0xc30 + i) * 0.18;
    const baseY = topY + 0.42 + i * baseScale * 0.72;
    const baseZ = engineZ + deterministicUnitSigned(entity.id, 0xc40 + i) * 0.15;
    mesh.position.set(baseX, baseY, baseZ);
    mesh.scale.setScalar(baseScale);
    mesh.renderOrder = 37;
    root.add(mesh);
    effects.push({
      mesh,
      stage,
      kind: 'smoke',
      baseX,
      baseY,
      baseZ,
      baseScale,
      phase: deterministicUnit(entity.id, 0xc50 + i) * Math.PI * 2,
    });
  }

  const fire = new Mesh(UNIT_DAMAGE_FIRE_GEOM, ember);
  const fireScale = isAircraft ? 0.36 : 0.42;
  const fireY = topY + 0.28;
  fire.position.set(engineX, fireY, engineZ);
  fire.renderOrder = 38;
  root.add(fire);
  effects.push({
    mesh: fire,
    stage: 3,
    kind: 'fire',
    baseX: engineX,
    baseY: fireY,
    baseZ: engineZ,
    baseScale: fireScale,
    phase: deterministicUnit(entity.id, 0xcf1) * Math.PI * 2,
  });

  for (const patch of patches) patch.mesh.visible = false;
  for (const effect of effects) effect.mesh.visible = false;
  return { root, patches, effects };
}

function createTeamMaterials(ctx: RenderContext, id: FactionId, own: boolean): TeamMaterials {
  const f = FACTION[id];
  return {
    hull: ctx.setupLitMaterial(new MeshStandardMaterial({ color: f.hull, emissive: own ? f.accent : 0x000000, emissiveIntensity: own ? 0.14 : 0, roughness: 0.78, metalness: 0.08 })),
    dark: ctx.setupLitMaterial(new MeshStandardMaterial({ color: f.hullDark, emissive: own ? f.accent : 0x000000, emissiveIntensity: own ? 0.08 : 0, roughness: 0.82, metalness: 0.12 })),
    canvas: ctx.setupLitMaterial(new MeshStandardMaterial({ color: f.canvas, emissive: own ? f.accent : 0x000000, emissiveIntensity: own ? 0.1 : 0, roughness: 0.9, metalness: 0.02 })),
    uniform: ctx.setupLitMaterial(new MeshStandardMaterial({ map: createCamoTexture(id), emissive: own ? f.accent : 0x000000, emissiveIntensity: own ? 0.12 : 0, roughness: 0.92, metalness: 0.01 })),
    accent: ctx.setupLitMaterial(new MeshStandardMaterial({ color: f.accent, emissive: own ? f.accent : f.accentEmissive, emissiveIntensity: own ? 1.35 : 1, roughness: 0.7, metalness: 0.1 })),
    lightBar: ctx.setupLitMaterial(
      new MeshStandardMaterial({ color: f.lightBar, emissive: f.lightBar, emissiveIntensity: own ? 2.2 : 0.55, roughness: 0.55, metalness: 0.05 }),
    ),
  };
}

function createFriendlyGlowMesh(id: FactionId): FriendlyGlowMesh {
  const palette = FACTION[id];
  const material = new MeshBasicMaterial({
    color: palette.lightBar,
    transparent: true,
    opacity: 0.115,
    depthWrite: false,
    depthTest: true,
    side: BackSide,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new InstancedMesh(FRIENDLY_GLOW_GEOM, material, MAX_FRIENDLY_GLOWS);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 22;
  return { mesh, count: 0 };
}

function createLowDetailMeshes(ctx: RenderContext, id: FactionId): Record<LowDetailKind, LowDetailMesh> {
  const palette = FACTION[id];
  const make = (kind: LowDetailKind): LowDetailMesh => {
    // Emergency meshes still participate in battlefield lighting. Unlit white
    // detail materials looked like corrupt surfaces on the desert sunset map;
    // a restrained faction accent keeps teams readable without glowing.
    const bodyMaterial = ctx.setupLitMaterial(new MeshLambertMaterial({ color: palette.hullDark, flatShading: true }));
    const colorMaterial = ctx.setupLitMaterial(new MeshLambertMaterial({ color: palette.hull, flatShading: true }));
    const detailMaterial = ctx.setupLitMaterial(new MeshLambertMaterial({
      color: palette.accent,
      emissive: palette.accentEmissive,
      emissiveIntensity: 0.35,
      flatShading: true,
    }));
    const body = new InstancedMesh(LOW_DETAIL_GEOMETRY[kind].body, bodyMaterial, MAX_LOW_DETAIL_UNITS);
    const color = new InstancedMesh(LOW_DETAIL_GEOMETRY[kind].color, colorMaterial, MAX_LOW_DETAIL_UNITS);
    const detail = new InstancedMesh(LOW_DETAIL_GEOMETRY[kind].detail, detailMaterial, MAX_LOW_DETAIL_UNITS);
    for (const mesh of [body, color, detail]) {
      mesh.count = 0;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = 20;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
    color.renderOrder = 21;
    detail.renderOrder = 21;
    return { body, color, detail, count: 0 };
  };
  return {
    infantry: make('infantry'),
    vehicle: make('vehicle'),
    aircraft: make('aircraft'),
  };
}

type LowDetailBox = [width: number, height: number, depth: number, x: number, y: number, z: number];

function mergeLowDetailBoxes(boxes: LowDetailBox[]): BufferGeometry {
  const pieces = boxes.map(([width, height, depth, x, y, z]) => {
    const geometry = new BoxGeometry(width, height, depth);
    geometry.translate(x, y, z);
    return geometry;
  });
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('Could not create low-detail unit geometry');
  return markShared(merged);
}

// Performance mode still uses only three batched draw calls per faction and
// unit category, but each category keeps a recognizable layered silhouette
// instead of the old single-colour box.
const LOW_DETAIL_GEOMETRY: Record<LowDetailKind, { body: BufferGeometry; color: BufferGeometry; detail: BufferGeometry }> = {
  infantry: {
    body: mergeLowDetailBoxes([
      [0.2, 0.62, 0.2, -0.18, -0.55, 0],
      [0.2, 0.62, 0.2, 0.18, -0.55, 0],
      [0.18, 0.18, 0.92, 0.32, 0.18, 0.25],
    ]),
    color: mergeLowDetailBoxes([[0.56, 0.72, 0.42, 0, 0.08, 0]]),
    detail: mergeLowDetailBoxes([
      [0.43, 0.4, 0.43, 0, 0.65, 0],
      [0.36, 0.12, 0.12, 0, 0.3, 0.24],
    ]),
  },
  vehicle: {
    body: mergeLowDetailBoxes([
      [0.23, 0.34, 1.58, -0.43, -0.23, 0],
      [0.23, 0.34, 1.58, 0.43, -0.23, 0],
    ]),
    color: mergeLowDetailBoxes([[0.82, 0.46, 1.38, 0, -0.03, 0]]),
    detail: mergeLowDetailBoxes([
      [0.62, 0.34, 0.62, 0, 0.34, 0.08],
      [0.15, 0.14, 0.9, 0, 0.38, 0.66],
    ]),
  },
  aircraft: {
    body: mergeLowDetailBoxes([
      [0.62, 0.66, 1.9, 0, 0, 0],
      [0.3, 0.46, 1.02, 0, 0.14, -1.28],
      [0.4, 0.5, 0.92, -0.92, -0.06, 0.08],
      [0.4, 0.5, 0.92, 0.92, -0.06, 0.08],
    ]),
    color: mergeLowDetailBoxes([
      [2.7, 0.24, 0.76, 0, -0.03, 0.08],
      [1.08, 0.2, 0.42, 0, 0.12, -1.55],
    ]),
    detail: mergeLowDetailBoxes([
      [0.46, 0.38, 0.7, 0, 0.4, 0.48],
      [0.18, 0.26, 0.82, 0, 0.56, -1.42],
    ]),
  },
};

function createBikeDustMesh(kind: Heightfield['kind']): InstancedMesh {
  const color = kind === 'frostbite-pass' ? 0xaebdc3 : kind === 'crater-oasis' ? 0xc69458 : 0x9b8965;
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: kind === 'frostbite-pass' ? 0.28 : 0.2,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new InstancedMesh(BIKE_DUST_GEOM, material, MAX_BIKE_DUST_PARTICLES);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 21;
  return mesh;
}

function createCamoTexture(id: FactionId): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('camo canvas unavailable');
  const colors = factionCamoColors(id);
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

function angledBox(
  x: number,
  y: number,
  z: number,
  material: Material,
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0,
): Mesh {
  const mesh = box(x, y, z, material, px, py, pz);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

/**
 * Small, readable bolt-on modules for purchased upgrades. These stay outside
 * the compacted base meshes so they can be toggled without rebuilding a unit.
 */
function createUnitUpgradeVisuals(
  entity: Entity,
  materials: TeamMaterials,
  gunmetal: Material,
): Map<UnitUpgradeId, Object3D> {
  const visuals = new Map<UnitUpgradeId, Object3D>();
  const kind = unitKindForUpgrade(entity);
  if (!kind) return visuals;
  for (const def of upgradeOptionsForKind(kind)) {
    if (def.id === 'combat-bike') continue; // The animated bike already lives in the soldier rig.
    const visual = createUnitUpgradeModule(def.id, materials, gunmetal);
    visual.name = `upgrade-${def.id}`;
    visual.visible = hasUnitUpgrade(entity, def.id);
    visuals.set(def.id, visual);
  }
  return visuals;
}

function createUnitUpgradeModule(id: UnitUpgradeId, materials: TeamMaterials, gunmetal: Material): Group {
  const group = new Group();
  const addTube = (
    radius: number,
    length: number,
    material: Material,
    x: number,
    y: number,
    z: number,
    alongZ = true,
  ): Mesh => {
    const mesh = new Mesh(sharedCylinderGeometry(radius * 0.76, radius, length, 8), material);
    if (alongZ) mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const addMissile = (x: number, y: number, z: number, scale = 1): void => {
    addTube(0.12 * scale, 0.78 * scale, gunmetal, x, y, z);
    const tip = new Mesh(sharedCylinderGeometry(0, 0.13 * scale, 0.28 * scale, 8), materials.lightBar);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(x, y, z + 0.52 * scale);
    group.add(tip);
  };

  switch (id) {
    case 'tesla-dart': {
      group.add(box(0.34, 0.52, 0.18, materials.dark, 0, 1.52, -0.27));
      for (const x of [-0.12, 0.12]) addTube(0.055, 0.46, materials.lightBar, x, 1.54, -0.39, false);
      group.add(box(0.38, 0.055, 0.08, materials.accent, 0, 1.76, -0.39));
      break;
    }
    case 'cluster-satchel': {
      for (const x of [-0.34, 0.34]) {
        group.add(box(0.18, 0.42, 0.24, materials.canvas, x, 1.39, -0.2));
        group.add(box(0.19, 0.055, 0.26, materials.accent, x, 1.54, -0.2));
      }
      break;
    }
    case 'rail-lance': {
      const rail = addTube(0.035, 1.42, gunmetal, -0.28, 1.51, -0.32);
      rail.rotation.z = -0.16;
      group.add(angledBox(0.08, 0.07, 0.72, materials.lightBar, -0.21, 1.54, -0.33, 0, 0, -0.16));
      group.add(box(0.22, 0.22, 0.18, materials.dark, 0.2, 1.4, -0.28));
      break;
    }
    case 'hydra-volley': {
      group.add(box(0.48, 0.48, 0.25, materials.dark, 0, 1.48, -0.32));
      for (const x of [-0.15, 0, 0.15]) addTube(0.055, 0.48, materials.lightBar, x, 1.5, -0.48);
      break;
    }
    case 'jackal-overdrive': {
      for (const x of [-1.48, 1.48]) {
        group.add(box(0.2, 0.26, 2.9, materials.accent, x, 0.82, -0.15));
        addTube(0.16, 0.72, materials.lightBar, x, 0.94, -1.8);
      }
      break;
    }
    case 'jackal-hunter': {
      group.add(box(1.08, 0.3, 0.86, materials.dark, 0, 1.63, -0.55));
      for (const x of [-0.34, 0, 0.34]) addMissile(x, 1.68, -0.38, 0.72);
      break;
    }
    case 'reactive-plating': {
      for (const x of [-1.78, 1.78]) {
        for (const z of [-1.55, -0.52, 0.52, 1.55]) {
          group.add(angledBox(0.18, 0.55, 0.76, materials.accent, x, 0.9, z, 0, 0, x < 0 ? -0.06 : 0.06));
        }
      }
      for (const x of [-0.78, 0, 0.78]) group.add(box(0.62, 0.11, 0.72, materials.accent, x, 1.32, -1.25));
      const drone = new Group();
      drone.name = 'escortDrone';
      drone.add(box(0.82, 0.25, 0.72, materials.dark, 0, 0, 0));
      drone.add(angledBox(0.62, 0.18, 0.55, materials.hull, 0, 0.15, -0.04, -0.08));
      drone.add(box(1.42, 0.08, 0.16, gunmetal, 0, 0.02, -0.04));
      drone.add(box(0.18, 0.16, 0.62, gunmetal, 0, -0.02, 0.48));
      drone.add(box(0.16, 0.13, 0.24, materials.lightBar, 0, 0, 0.83));
      drone.add(box(0.52, 0.06, 0.12, materials.accent, 0, 0.27, -0.1));
      for (const x of [-0.7, 0.7]) {
        const rotor = new Group();
        rotor.name = 'escortDroneRotor';
        rotor.position.set(x, 0.14, -0.04);
        rotor.add(box(0.72, 0.025, 0.08, materials.lightBar, 0, 0, 0));
        rotor.add(box(0.08, 0.025, 0.72, materials.lightBar, 0, 0, 0));
        drone.add(rotor);
      }
      group.add(drone);
      break;
    }
    case 'ion-spear': {
      group.add(box(1.24, 0.38, 1.18, materials.dark, 0, 1.72, -1.02));
      addMissile(0, 1.83, -0.72, 1.25);
      for (const x of [-0.42, 0.42]) group.add(box(0.16, 0.16, 0.92, materials.lightBar, x, 1.78, -0.72));
      break;
    }
    case 'siege-stabilizers': {
      for (const x of [-2.9, 2.9]) {
        group.add(angledBox(0.34, 0.34, 2.25, gunmetal, x, 0.55, -0.2, 0, 0, x < 0 ? -0.22 : 0.22));
        group.add(box(0.86, 0.2, 0.84, materials.accent, x, 0.16, 0.74));
        group.add(box(0.86, 0.2, 0.84, materials.accent, x, 0.16, -1.16));
      }
      break;
    }
    case 'earthshaker-round': {
      group.add(box(1.8, 0.44, 1.52, materials.dark, 0, 2.32, -2.18));
      addMissile(0, 2.5, -1.92, 1.75);
      group.add(box(1.45, 0.12, 0.22, materials.accent, 0, 2.57, -2.05));
      break;
    }
    case 'vector-thrusters': {
      for (const x of [-1.2, 1.2]) {
        addTube(0.28, 1.35, gunmetal, x, 0.12, -0.3);
        group.add(box(0.38, 0.12, 0.66, materials.lightBar, x, 0.12, -1.13));
      }
      break;
    }
    case 'needle-storm': {
      for (const x of [-1.12, 1.12]) {
        group.add(box(0.58, 0.34, 0.92, materials.dark, x, -0.06, 0.72));
        for (const dx of [-0.16, 0.16]) addMissile(x + dx, -0.02, 0.84, 0.55);
      }
      break;
    }
    case 'specter-plating': {
      for (const x of [-1.18, 1.18]) group.add(angledBox(0.22, 0.82, 3.65, materials.accent, x, 0.4, -0.1, 0, 0, x < 0 ? -0.09 : 0.09));
      group.add(angledBox(1.55, 0.15, 2.1, materials.dark, 0, 0.84, -0.2, -0.04));
      break;
    }
    case 'bunker-buster': {
      addMissile(0, -0.48, 0.68, 1.8);
      group.add(box(0.92, 0.12, 1.8, materials.accent, 0, -0.38, 0.35));
      break;
    }
    case 'titan-lift': {
      for (const x of [-2.7, 2.7]) {
        addTube(0.35, 1.4, materials.accent, x, 0.35, -0.25, false);
        group.add(box(0.7, 0.16, 0.7, materials.lightBar, x, 1.02, -0.25));
      }
      group.add(box(4.2, 0.18, 0.36, gunmetal, 0, 0.72, -0.25));
      break;
    }
    case 'skyfall-warhead': {
      addMissile(0, -0.6, 0.82, 2.25);
      group.add(box(1.25, 0.14, 2.4, materials.accent, 0, -0.47, 0.35));
      for (const x of [-0.55, 0.55]) group.add(box(0.16, 0.42, 0.9, materials.lightBar, x, -0.42, 0.72));
      break;
    }
    case 'combat-bike':
      break;
  }
  return group;
}

function mergeDirectMeshesByMaterial(
  parent: Object3D,
  material: Material,
  cacheKey: string,
  excluded: ReadonlySet<Object3D> = new Set(),
): void {
  const children = parent.children.filter(
    (child): child is Mesh => child instanceof Mesh && child.material === material && !excluded.has(child),
  );
  if (children.length < 2) return;
  let merged = mergedUnitGeometryCache.get(cacheKey);
  if (!merged) {
    const pieces = children.map((child) => {
      child.updateMatrix();
      const geometry = child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      return geometry;
    });
    const combined = mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    if (!combined) throw new Error(`Could not merge ${cacheKey} geometry`);
    merged = markShared(combined);
    mergedUnitGeometryCache.set(cacheKey, merged);
  }
  parent.remove(...children);
  parent.add(new Mesh(merged, material));
}

function compactVehicleMeshes(
  kind: UnitVisualKind,
  group: Group,
  turret: Group,
  barrel: Group,
  materials: TeamMaterials,
  gunmetal: Material,
): void {
  const materialGroups: Array<[string, Material]> = [
    ['hull', materials.hull],
    ['dark', materials.dark],
    ['accent', materials.accent],
    ['canvas', materials.canvas],
    ['light', materials.lightBar],
    ['metal', gunmetal],
  ];
  for (const [key, material] of materialGroups) {
    mergeDirectMeshesByMaterial(group, material, `${kind}-chassis-${key}`);
    mergeDirectMeshesByMaterial(turret, material, `${kind}-turret-${key}`);
  }
  mergeDirectMeshesByMaterial(barrel, gunmetal, `${kind}-barrel-metal`);
}

function compactHarvesterMeshes(
  group: Group,
  scoop: Group,
  materials: TeamMaterials,
  gunmetal: Material,
  cargoLoad: Object3D,
  movingParts: ReadonlyArray<Object3D> = [],
): void {
  const materialGroups: Array<[string, Material]> = [
    ['hull', materials.hull],
    ['dark', materials.dark],
    ['accent', materials.accent],
    ['canvas', materials.canvas],
    ['light', materials.lightBar],
    ['metal', gunmetal],
  ];
  const excluded = new Set<Object3D>([cargoLoad, ...movingParts]);
  for (const [key, material] of materialGroups) {
    mergeDirectMeshesByMaterial(group, material, `harvester-chassis-${key}`, excluded);
    mergeDirectMeshesByMaterial(scoop, material, `harvester-scoop-${key}`);
  }
}

function createVehicleObject(
  kind: UnitVisualKind,
  materials: TeamMaterials,
  gunmetal: Material,
  muzzleMaterial: Material,
): BuiltUnit {
  const group = new Group();
  const turretPivot = new Group();
  group.add(turretPivot);
  const barrelPivot = new Group();
  const antenna = new Group();
  let muzzleFlash: Mesh | undefined;
  let barrelHomeZ: number | undefined;
  if (kind === 'jackal') {
    group.add(box(2.72, 0.68, 4.45, materials.hull, 0, 0.58, 0.05));
    group.add(angledBox(2.5, 0.34, 1.5, materials.hull, 0, 0.88, 1.7, -0.2));
    group.add(box(1.72, 0.44, 1.45, materials.dark, 0, 1.02, -1.28));
    group.add(box(1.55, 0.08, 0.18, materials.accent, 0, 1.19, 1.66));
    for (const side of [-1, 1]) {
      group.add(box(0.18, 0.16, 4.15, materials.dark, side * 1.52, 0.78, 0.02));
      for (const z of [-1.55, 0, 1.55]) {
        const wheel = new Mesh(sharedCylinderGeometry(0.42, 0.42, 0.32, 14), materials.dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 1.55, 0.36, z);
        group.add(wheel);
        const hub = new Mesh(sharedCylinderGeometry(0.15, 0.15, 0.35, 10), materials.accent);
        hub.rotation.z = Math.PI / 2;
        hub.position.copy(wheel.position);
        group.add(hub);
      }
      group.add(box(0.38, 0.24, 0.34, materials.lightBar, side * 1.05, 0.76, 2.18));
      group.add(box(0.42, 0.44, 0.72, materials.canvas, side * 0.96, 1.03, -1.72));
    }
    turretPivot.position.y = 1.04;
    const turretRing = new Mesh(sharedCylinderGeometry(0.66, 0.76, 0.18, 10), gunmetal);
    turretRing.position.y = -0.08;
    turretPivot.add(turretRing);
    turretPivot.add(angledBox(1.42, 0.36, 1.48, materials.dark, 0, 0.12, -0.18, -0.04));
    turretPivot.add(box(1.28, 0.08, 0.25, materials.accent, 0, 0.32, 0.5));
    const optic = new Mesh(sharedCylinderGeometry(0.2, 0.24, 0.24, 10), materials.lightBar);
    optic.position.set(0.42, 0.46, -0.22);
    turretPivot.add(optic);
    barrelPivot.position.set(0, 0.16, 0.18);
    barrelHomeZ = barrelPivot.position.z;
    barrelPivot.add(box(0.12, 0.12, 2.55, gunmetal, -0.18, 0, 1.36));
    barrelPivot.add(box(0.12, 0.12, 2.55, gunmetal, 0.18, 0, 1.36));
    barrelPivot.add(box(0.48, 0.24, 0.32, gunmetal, 0, 0, 0.22));
    muzzleFlash = new Mesh(sharedCylinderGeometry(0, 0.34, 0.86, 8), muzzleMaterial);
    muzzleFlash.rotation.x = Math.PI / 2;
    muzzleFlash.position.z = 3.02;
    muzzleFlash.visible = false;
    barrelPivot.add(muzzleFlash);
    turretPivot.add(barrelPivot);
    antenna.position.set(1.05, 1.08, -1.75);
  } else if (kind === 'mauler') {
    group.add(box(3.82, 0.72, 7.12, materials.hull, 0, 0.55, -0.28));
    group.add(angledBox(3.62, 0.38, 1.72, materials.hull, 0, 0.9, 2.54, -0.17));
    group.add(angledBox(3.42, 0.28, 1.35, materials.dark, 0, 0.96, -2.82, 0.1));
    for (const side of [-1, 1]) {
      const x = side * 2.32;
      group.add(box(0.82, 0.56, 6.92, materials.dark, x, 0.38, -0.2));
      group.add(box(0.18, 0.72, 6.25, materials.hull, side * 2.58, 0.78, -0.18));
      for (const z of [-2.55, -1.28, 0, 1.28, 2.55]) {
        const wheel = new Mesh(sharedCylinderGeometry(0.55, 0.55, 0.34, 16), gunmetal);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.42, z);
        group.add(wheel);
      }
      group.add(box(0.9, 0.13, 6.8, gunmetal, x, 0.04, -0.2));
      group.add(box(0.9, 0.13, 6.8, gunmetal, x, 0.92, -0.2));
      group.add(box(0.38, 0.26, 0.34, materials.lightBar, side * 1.38, 0.83, 3.32));
      group.add(angledBox(1.2, 0.28, 0.88, materials.dark, side * 1.48, 0.34, -4.03, 0.18));
    }
    group.add(box(2.75, 0.08, 0.34, materials.accent, 0, 1.18, 3.1));
    for (const x of [-1.1, -0.55, 0, 0.55, 1.1]) {
      group.add(box(0.36, 0.08, 1.32, gunmetal, x, 1.18, -2.12));
    }
    turretPivot.position.set(0, 1.2, -0.78);
    const turretRing = new Mesh(sharedCylinderGeometry(1.22, 1.38, 0.25, 12), gunmetal);
    turretRing.position.y = -0.16;
    turretPivot.add(turretRing);
    turretPivot.add(angledBox(2.65, 0.68, 2.55, materials.dark, 0, 0.14, -0.04, -0.035));
    turretPivot.add(angledBox(2.15, 0.34, 1.5, materials.hull, 0, 0.58, -0.22, 0.05));
    turretPivot.add(box(2.2, 0.09, 0.28, materials.accent, 0, 0.62, 0.82));
    barrelPivot.position.set(0, 0.08, 0.8);
    barrelHomeZ = barrelPivot.position.z;
    barrelPivot.add(box(0.24, 0.24, 5.9, gunmetal, 0, 0, 2.9));
    barrelPivot.add(box(0.54, 0.42, 0.48, gunmetal, 0, 0, 0.28));
    barrelPivot.add(box(0.72, 0.26, 0.34, gunmetal, 0, 0, 5.82));
    barrelPivot.add(box(0.84, 0.2, 0.16, gunmetal, 0, 0, 6.02));
    muzzleFlash = new Mesh(sharedCylinderGeometry(0, 0.62, 1.42, 8), muzzleMaterial);
    muzzleFlash.rotation.x = Math.PI / 2;
    muzzleFlash.position.z = 6.85;
    muzzleFlash.visible = false;
    barrelPivot.add(muzzleFlash);
    turretPivot.add(barrelPivot);
    const hatch = new Mesh(sharedCylinderGeometry(0.42, 0.5, 0.2, 10), materials.dark);
    hatch.position.set(0.6, 0.82, -0.38);
    turretPivot.add(hatch);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const launcher = new Mesh(sharedCylinderGeometry(0.1, 0.12, 0.46, 8), gunmetal);
        launcher.rotation.x = Math.PI * 0.32;
        launcher.rotation.z = side * 0.2;
        launcher.position.set(side * 1.34, 0.44, 0.35 - i * 0.3);
        turretPivot.add(launcher);
      }
      turretPivot.add(box(0.72, 0.46, 0.84, materials.canvas, side * 1.2, 0.28, -1.2));
    }
    antenna.position.set(-1.45, 1.0, -2.45);
  } else {
    // M-17 vertical slice: layered armour, readable running gear and a much
    // stronger turret silhouette while keeping every shape cheap and shared.
    group.add(box(3.5, 0.68, 4.75, materials.hull, 0, 0.62, -0.08));
    group.add(angledBox(3.34, 0.32, 1.65, materials.hull, 0, 0.88, 1.88, -0.18));
    group.add(angledBox(3.18, 0.24, 1.32, materials.dark, 0, 0.98, -1.88, 0.12));
    group.add(box(2.72, 0.18, 1.42, materials.dark, 0, 1.06, -1.12));
    group.add(box(2.5, 0.07, 0.12, materials.accent, 0, 1.16, 2.53));

    for (const side of [-1, 1]) {
      const x = side * 2.02;
      group.add(box(0.7, 0.5, 5.42, materials.dark, x, 0.37, 0));
      group.add(angledBox(0.16, 0.7, 4.72, materials.hull, side * 2.25, 0.76, 0.05, 0, 0, side * 0.045));
      group.add(box(0.19, 0.1, 3.9, materials.accent, side * 2.35, 0.97, 0.08));
      for (const z of [-1.8, -0.9, 0, 0.9, 1.8]) {
        const wheel = new Mesh(sharedCylinderGeometry(0.46, 0.46, 0.3, 16), gunmetal);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.4, z);
        group.add(wheel);
        const hub = new Mesh(sharedCylinderGeometry(0.17, 0.17, 0.33, 12), materials.accent);
        hub.rotation.z = Math.PI / 2;
        hub.position.copy(wheel.position);
        group.add(hub);
      }
      for (const z of [-2.32, 2.32]) {
        const sprocket = new Mesh(sharedCylinderGeometry(0.55, 0.55, 0.34, 16), gunmetal);
        sprocket.rotation.z = Math.PI / 2;
        sprocket.position.set(x, 0.48, z);
        group.add(sprocket);
      }
      group.add(box(0.82, 0.12, 5.15, gunmetal, x, 0.02, 0));
      group.add(box(0.82, 0.12, 5.15, gunmetal, x, 0.86, 0));
    }

    // Rear engine deck, stowage and exhausts help the vehicle read correctly
    // from the RTS camera instead of looking like a single featureless block.
    for (const x of [-0.9, -0.3, 0.3, 0.9]) {
      group.add(box(0.42, 0.08, 1.05, gunmetal, x, 1.2, -1.42));
    }
    for (const side of [-1, 1]) {
      const exhaust = new Mesh(sharedCylinderGeometry(0.13, 0.16, 0.72, 10), gunmetal);
      exhaust.position.set(side * 1.42, 1.28, -1.82);
      group.add(exhaust);
      group.add(box(0.44, 0.36, 0.76, materials.canvas, side * 1.42, 1.22, -0.92));
      group.add(box(0.26, 0.22, 0.18, materials.lightBar, side * 1.46, 0.78, 2.48));
    }

    turretPivot.position.y = 1.33;
    const turretRing = new Mesh(sharedCylinderGeometry(1.12, 1.28, 0.22, 12), gunmetal);
    turretRing.position.y = -0.12;
    turretPivot.add(turretRing);
    turretPivot.add(angledBox(2.32, 0.72, 2.36, materials.dark, 0, 0.18, -0.08, -0.04));
    turretPivot.add(angledBox(1.92, 0.36, 1.4, materials.hull, 0, 0.58, -0.18, 0.05));
    turretPivot.add(box(2.0, 0.08, 0.18, materials.accent, 0, 0.62, 0.72));
    turretPivot.add(box(0.72, 0.14, 0.22, materials.lightBar, 0, 0.58, -1.22));

    const mantlet = new Mesh(sharedCylinderGeometry(0.36, 0.4, 0.64, 12), gunmetal);
    mantlet.rotation.x = Math.PI / 2;
    mantlet.position.set(0, 0.22, 1.14);
    turretPivot.add(mantlet);
    barrelPivot.position.set(0, 0.22, 1.08);
    barrelHomeZ = barrelPivot.position.z;
    barrelPivot.add(box(0.3, 0.3, 3.15, gunmetal, 0, 0, 1.58));
    barrelPivot.add(box(0.42, 0.42, 0.36, gunmetal, 0, 0, 3.16));
    barrelPivot.add(box(0.52, 0.3, 0.16, gunmetal, 0, 0, 3.34));
    muzzleFlash = new Mesh(sharedCylinderGeometry(0, 0.44, 1.05, 8), muzzleMaterial);
    muzzleFlash.rotation.x = Math.PI / 2;
    muzzleFlash.position.z = 3.92;
    muzzleFlash.visible = false;
    barrelPivot.add(muzzleFlash);
    turretPivot.add(barrelPivot);

    const hatch = new Mesh(sharedCylinderGeometry(0.42, 0.52, 0.2, 10), materials.dark);
    hatch.position.set(0.48, 0.82, -0.4);
    turretPivot.add(hatch);
    const cupola = new Mesh(sharedCylinderGeometry(0.27, 0.32, 0.22, 10), gunmetal);
    cupola.position.set(0.48, 0.98, -0.4);
    turretPivot.add(cupola);
    turretPivot.add(box(0.12, 0.12, 1.15, gunmetal, -0.55, 0.84, 0.2));
    turretPivot.add(box(0.22, 0.18, 0.42, gunmetal, -0.55, 0.84, -0.52));

    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const launcher = new Mesh(sharedCylinderGeometry(0.09, 0.11, 0.42, 8), gunmetal);
        launcher.rotation.x = Math.PI * 0.34;
        launcher.rotation.z = side * 0.18;
        launcher.position.set(side * (1.18 + i * 0.04), 0.42, 0.3 - i * 0.28);
        turretPivot.add(launcher);
      }
    }
    turretPivot.add(box(0.62, 0.4, 0.76, materials.canvas, -1.03, 0.28, -1.08));
    turretPivot.add(box(0.62, 0.4, 0.76, materials.canvas, 1.03, 0.28, -1.08));
    antenna.position.set(1.12, 1.83, -1.15);
  }
  const whip = new Mesh(sharedCylinderGeometry(0.012, 0.018, 1.15, 5), gunmetal);
  whip.position.y = 0.58;
  antenna.add(whip);
  group.add(antenna);
  compactVehicleMeshes(kind, group, turretPivot, barrelPivot, materials, gunmetal);
  return {
    root: group,
    refs: {
      turretPivot,
      barrelPivot,
      barrelHomeZ,
      muzzleFlash,
      groundDrive: true,
      antenna,
    },
  };
}

function createHarvesterObject(materials: TeamMaterials, gunmetal: Material): BuiltUnit {
  const group = new Group();

  // The Oris is a self-contained strip miner: low tracked propulsion, an
  // offset armored cab, exposed intake/conveyor machinery, and a deep rear
  // hopper. Its job is readable from the silhouette before any UI appears.
  group.add(box(4.65, 0.7, 6.65, materials.hull, 0, 0.62, -0.05));
  group.add(angledBox(4.25, 0.34, 1.4, materials.hull, 0, 0.92, 2.55, -0.15));
  group.add(angledBox(4.1, 0.28, 1.2, materials.dark, 0, 0.96, -2.78, 0.12));
  group.add(box(3.1, 0.12, 0.28, materials.accent, 0, 1.0, 3.16));

  // Wide crawler units keep the collector visually heavier than combat tanks.
  for (const side of [-1, 1]) {
    const trackX = side * 2.42;
    group.add(box(0.86, 0.62, 6.42, materials.dark, trackX, 0.42, -0.02));
    group.add(angledBox(0.2, 0.72, 5.8, materials.hull, side * 2.72, 0.78, -0.04, 0, 0, side * 0.04));
    for (const z of [-2.35, -1.18, 0, 1.18, 2.35]) {
      const wheel = new Mesh(sharedCylinderGeometry(z === 0 ? 0.5 : 0.58, z === 0 ? 0.5 : 0.58, 0.4, 16), gunmetal);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(trackX, 0.43, z);
      group.add(wheel);
      const hub = new Mesh(sharedCylinderGeometry(0.19, 0.19, 0.43, 10), materials.accent);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      group.add(hub);
    }
    group.add(box(0.94, 0.13, 6.15, gunmetal, trackX, 0.02, -0.02));
    group.add(box(0.94, 0.13, 6.15, gunmetal, trackX, 0.92, -0.02));
    group.add(box(0.28, 0.2, 0.28, materials.lightBar, side * 1.66, 0.88, 3.24));
    group.add(box(0.38, 0.28, 0.28, materials.accent, side * 1.72, 0.76, -3.28));
  }

  // Asymmetric cab and engine module make it feel engineered rather than
  // assembled from centered boxes.
  group.add(angledBox(2.2, 1.42, 1.88, materials.hull, -0.92, 1.52, 1.68, -0.08, 0.03));
  group.add(angledBox(1.72, 0.55, 0.13, materials.lightBar, -0.92, 1.84, 2.65, -0.08, 0.03));
  group.add(box(0.13, 0.56, 1.15, materials.lightBar, -2.04, 1.72, 1.7));
  group.add(box(1.28, 0.13, 1.7, materials.dark, -0.92, 2.27, 1.64));
  group.add(box(1.05, 0.11, 0.18, materials.accent, -0.92, 2.37, 1.78));

  group.add(box(1.55, 0.98, 1.8, materials.dark, 1.08, 1.42, 1.46));
  for (const z of [0.92, 1.34, 1.76]) {
    group.add(box(1.25, 0.08, 0.2, gunmetal, 1.08, 1.92, z));
  }
  const exhaust = new Mesh(sharedCylinderGeometry(0.14, 0.19, 1.38, 10), gunmetal);
  exhaust.position.set(1.62, 2.02, 0.88);
  group.add(exhaust);
  group.add(box(0.32, 0.12, 0.36, gunmetal, 1.62, 2.72, 0.88));

  // An open, reinforced hopper shows the player's haul growing in real time.
  group.add(angledBox(3.78, 1.0, 0.24, materials.dark, 0.18, 1.55, -2.62, 0.18));
  for (const side of [-1, 1]) {
    group.add(angledBox(0.25, 1.02, 2.72, materials.dark, 0.18 + side * 1.9, 1.52, -1.2, 0, 0, side * 0.15));
    for (const z of [-2.18, -1.48, -0.78, -0.08]) {
      group.add(box(0.14, 1.12, 0.13, gunmetal, 0.18 + side * 2.0, 1.52, z));
    }
  }
  for (const x of [-1.18, -0.5, 0.18, 0.86, 1.54]) {
    group.add(box(0.12, 0.1, 2.58, gunmetal, x, 1.08, -1.25));
  }

  const load = new Group();
  load.position.set(0.18, 1.72, -1.28);
  const oreChunks = [
    [-1.22, 0.02, -0.58, 0.72, 0.34, 0.62, -0.18],
    [-0.55, 0.2, -0.78, 0.86, 0.46, 0.72, 0.12],
    [0.2, 0.1, -0.58, 0.78, 0.38, 0.68, -0.08],
    [0.92, 0.18, -0.74, 0.76, 0.44, 0.66, 0.16],
    [-0.92, 0.14, 0.12, 0.82, 0.42, 0.68, 0.1],
    [-0.12, 0.26, 0.05, 0.92, 0.5, 0.74, -0.14],
    [0.75, 0.12, 0.18, 0.88, 0.4, 0.7, 0.08],
  ] as const;
  for (const [x, y, z, w, h, d, rot] of oreChunks) {
    const chunk = new Mesh(ORE_CHUNK_GEOM, materials.accent);
    chunk.position.set(x, y, z);
    chunk.scale.set(w * 0.62, h, d * 0.62);
    chunk.rotation.set(rot * 0.55, rot, rot * 0.35);
    load.add(chunk);
  }
  group.add(load);

  // The intake is a real articulated mining head, with a powered cutting drum
  // feeding a sloped conveyor instead of a decorative bulldozer blade.
  const scoop = new Group();
  scoop.position.set(0, 0.5, 3.18);
  scoop.add(angledBox(5.45, 0.3, 0.82, materials.dark, 0, 0.08, 0.42, -0.22));
  scoop.add(box(5.35, 0.16, 0.24, gunmetal, 0, -0.15, 0.92));
  for (const side of [-1, 1]) {
    scoop.add(angledBox(0.28, 0.3, 1.95, materials.hull, side * 2.42, 0.38, -0.28, -0.18));
    scoop.add(angledBox(0.24, 0.24, 1.78, materials.dark, side * 1.7, 0.44, -0.68, -0.2));
    const ram = new Mesh(sharedCylinderGeometry(0.1, 0.13, 1.72, 8), gunmetal);
    ram.rotation.x = Math.PI * 0.4;
    ram.position.set(side * 2.05, 0.76, -0.45);
    scoop.add(ram);
  }
  const harvestingRotor = new Group();
  harvestingRotor.position.set(0, 0.05, 1.05);
  const drum = new Mesh(sharedCylinderGeometry(0.58, 0.58, 5.08, 16), gunmetal);
  drum.rotation.z = Math.PI / 2;
  harvestingRotor.add(drum);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const toothBar = box(5.18, 0.12, 0.16, i % 2 === 0 ? materials.accent : gunmetal, 0, Math.cos(angle) * 0.65, Math.sin(angle) * 0.65);
    toothBar.rotation.x = angle;
    harvestingRotor.add(toothBar);
  }
  for (const side of [-1, 1]) {
    const cap = new Mesh(sharedCylinderGeometry(0.72, 0.72, 0.2, 16), materials.hull);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = side * 2.62;
    harvestingRotor.add(cap);
  }
  scoop.add(harvestingRotor);
  group.add(scoop);

  const conveyorRollers: Object3D[] = [];
  group.add(angledBox(1.2, 0.18, 3.25, materials.dark, 0.18, 1.26, 0.25, -0.38));
  for (const z of [-0.88, -0.24, 0.4, 1.04]) {
    const roller = new Mesh(sharedCylinderGeometry(0.16, 0.16, 1.05, 10), gunmetal);
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0.18, 1.32 + (z + 0.88) * 0.2, z);
    group.add(roller);
    conveyorRollers.push(roller);
  }
  for (const side of [-1, 1]) {
    group.add(angledBox(0.12, 0.22, 3.4, materials.accent, 0.18 + side * 0.66, 1.38, 0.22, -0.38));
  }

  const beaconMaterial = new MeshBasicMaterial({ color: 0xff3d24, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false });
  const beacon = new Mesh(sharedCylinderGeometry(0.24, 0.3, 0.27, 10), beaconMaterial);
  beacon.position.set(-0.3, 2.52, 1.62);
  beacon.visible = false;
  group.add(beacon);

  const antenna = new Group();
  antenna.position.set(-1.65, 2.34, 1.18);
  antenna.add(new Mesh(sharedCylinderGeometry(0.12, 0.16, 0.14, 8), gunmetal));
  const whip = new Mesh(sharedCylinderGeometry(0.012, 0.018, 1.05, 5), gunmetal);
  whip.position.y = 0.56;
  antenna.add(whip);
  group.add(antenna);
  compactHarvesterMeshes(group, scoop, materials, gunmetal, load, conveyorRollers);
  return {
    root: group,
    refs: {
      cargoLoad: load,
      scoop,
      harvestingRotor,
      conveyorRollers,
      warningBeacon: beacon,
      antenna,
      groundDrive: true,
    },
  };
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
