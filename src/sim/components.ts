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

export interface Mover {
  speed: number;
  radius: number;
  target?: { x: number; z: number };
  formationOffset?: { x: number; z: number };
  flow?: FlowField;
  attackMove?: boolean;
  /** optional final facing for right-drag move orders */
  faceYaw?: number;
  /** guard behavior: combat sets this each tick when a visible foe is out of weapon range */
  engage?: { x: number; z: number };
  /** temporary local-base response when a nearby friendly building is hit */
  defenseAlert?: { targetId: number; x: number; z: number; ttl: number };
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
  health?: Health;
  team?: Team;
  selectable?: Selectable;
  mover?: Mover;
  flight?: Flight;
  weapon?: Weapon;
  weapons?: WeaponRack;
  specialWeapon?: Weapon;
  unitUpgrades?: UnitUpgrades;
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
