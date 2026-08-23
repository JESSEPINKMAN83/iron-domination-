import type { FlowField } from './flowfield';
import type { ArmorClass } from '../content/phase4';
import type { FlightModelId } from '../content/flightModels';

export interface Transform {
  x: number;
  /** absolute altitude; ground units are glued to terrain height by the sim */
  y?: number;
  z: number;
  rot: number;
}

export interface Velocity {
  x: number;
  z: number;
}

/** Short-lived battlefield impulse layered over commanded movement. */
export interface ImpactMomentum {
  x: number;
  z: number;
  yaw: number;
  ttl: number;
  /** Brief movement suppression while infantry contacts the ground and braces. */
  stagger?: number;
}

export interface Health {
  current: number;
  max: number;
}

export interface Team {
  id: number;
}

export interface Selectable {
  selected: boolean;
  type: string;
  radius: number;
}

/** End behavior after a tactic waypoint path is finished. */
export type TacticEndAction =
  | { kind: 'hold' }
  | { kind: 'attack-move' }
  | { kind: 'attack'; targetId: number };

/** Multi-waypoint path plan; `remaining` are waypoints after the current `target`. */
export interface TacticPlan {
  remaining: Array<{ x: number; z: number }>;
  endAction: TacticEndAction;
}

export interface Mover {
  speed: number;
  radius: number;
  /** tracked-vehicle body yaw velocity; persisted so turns accelerate and settle instead of snapping */
  yawRate?: number;
  /** explicit RTS U-turn phase used when a new move order starts substantially behind a tracked vehicle */
  turnaround?: { targetYaw: number; direction: -1 | 1 };
  /** player-issued rapid transit order; cleared on arrival, stop, possession, or the next normal order */
  sprint?: boolean;
  target?: { x: number; z: number };
  formationOffset?: { x: number; z: number };
  /** assigned formation destination retained after arrival so separation cannot drift the unit away */
  holdPosition?: { x: number; z: number };
  flow?: FlowField;
  attackMove?: boolean;
  /** explicit player-issued target; unlike attack-move this must not be replaced by a nearer foe */
  attackTargetId?: number;
  /** optional final facing for right-drag move orders */
  faceYaw?: number;
  /** guard behavior: combat sets this each tick when a visible foe is out of weapon range */
  engage?: { x: number; z: number };
  /** temporary local-base response when a nearby friendly building is hit */
  defenseAlert?: { targetId: number; x: number; z: number; ttl: number };
  /** queued tactic path; cleared by stop/new orders or when the end action is applied */
  tactic?: TacticPlan;
}

export type InboundProfile = 'ballistic' | 'drone';

/** One-way strategic inbound: ballistic strike or slow attack drone. */
export interface InboundMissile {
  profile: InboundProfile;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  elapsed: number;
  flightTime: number;
  peakAltitude: number;
  launchY: number;
  impactY: number;
  warheadDamage: number;
  splashRadius: number;
  sizeScale: number;
}

export interface Flight {
  cruiseAltitude: number;
  minAGL: number;
  maxAltitude: number;
  climbRate: number;
  pitchAttitude: number;
  rollAttitude: number;
  previousPitchAttitude: number;
  previousRollAttitude: number;
  model: FlightModelId;
  bank: number;
  verticalVelocity: number;
}

export interface Weapon {
  kind: string;
  range: number;
  cooldown: number;
  salvoCount?: number;
  targetId?: number;
}

export interface AiCombat {
  accuracy: number;
  cooldownMultiplier: number;
  projectileScatter: number;
  targetAcquireDelayTicks: number;
  possessedTargetPriority: number;
  nextAcquireTick?: number;
}

export interface WeaponRack {
  primary: Weapon;
  secondary?: Weapon;
}

export interface UnitUpgrades {
  ids: string[];
  escortDrone?: {
    cooldown: number;
    targetId?: number;
    orbitAngle: number;
  };
}

/** Battlefield veterancy earned by surviving and destroying enemies. */
export interface CombatRank {
  rank: 0 | 1 | 2 | 3;
  killValue: number;
  unitCost: number;
}

export interface Turret {
  yaw: number;
  turnRate: number;
}

export interface Vision {
  radius: number;
}

export interface Cargo {
  capacity: number;
  amount: number;
}

export interface Harvester {
  state: 'seeking' | 'to-node' | 'gathering' | 'to-refinery' | 'depositing';
  nodeId?: number;
  refineryId?: number;
  timer: number;
  /** set when the collector was recently damaged; economy logic recalls it to safety */
  threatTimer?: number;
  /** last observed health, used to deterministically detect new damage */
  lastHealth?: number;
}

export interface Builder {
  buildRadius: number;
}

export interface Possessable {
  socketHeight: number;
}

export interface PlayerControlled {
  throttle: number;
  turn: number;
  aimYaw: number;
  climb?: number;
  strafe?: number;
  boost?: boolean;
}

export interface Collider {
  radius: number;
}

export interface Armor {
  kind: ArmorClass;
}

export interface Destroyed {
  remaining: number;
  aircraftCrash?: {
    velocityX: number;
    velocityZ: number;
    verticalVelocity: number;
    yawRate: number;
    rollRate: number;
    pitchRate: number;
    impacted: boolean;
  };
}

export interface Building {
  kind: string;
  label: string;
  footprint: { w: number; h: number };
  powerProduced: number;
  powerUsed: number;
  complete: boolean;
  buildProgress: number;
}

export interface StructureDamage {
  cols: number;
  rows: number;
  tiers: number;
  cells: Uint8Array;
  version: number;
}

export interface Producer {
  queue: ProductionJob[];
  active?: ProductionJob;
  rally?: { x: number; z: number };
}

export interface ProductionJob {
  kind: string;
  label: string;
  remaining: number;
  total: number;
  cost: number;
}

export interface Entity {
  id: number;
  name?: string;
  transform: Transform;
  previousTransform: Transform;
  velocity?: Velocity;
  impactMomentum?: ImpactMomentum;
  health?: Health;
  team?: Team;
  selectable?: Selectable;
  mover?: Mover;
  flight?: Flight;
  inboundMissile?: InboundMissile;
  weapon?: Weapon;
  weapons?: WeaponRack;
  specialWeapon?: Weapon;
  unitUpgrades?: UnitUpgrades;
  combatRank?: CombatRank;
  aiCombat?: AiCombat;
  turret?: Turret;
  vision?: Vision;
  cargo?: Cargo;
  harvester?: Harvester;
  builder?: Builder;
  possessable?: Possessable;
  playerControlled?: PlayerControlled;
  collider?: Collider;
  armor?: Armor;
  destroyed?: Destroyed;
  building?: Building;
  structureDamage?: StructureDamage;
  producer?: Producer;
}

export function copyTransform(t: Transform): Transform {
  return { x: t.x, y: t.y, z: t.z, rot: t.rot };
}
