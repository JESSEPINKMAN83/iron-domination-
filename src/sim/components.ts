import type { FlowField } from './flowfield';
import type { ArmorClass } from '../content/phase4';

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
  bank: number;
  verticalVelocity: number;
}

export interface Weapon {
  kind: string;
  range: number;
  cooldown: number;
  targetId?: number;
}

export interface WeaponRack {
  primary: Weapon;
  secondary?: Weapon;
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
  turret?: Turret;
  vision?: Vision;
  cargo?: Cargo;
  builder?: Builder;
  possessable?: Possessable;
  playerControlled?: PlayerControlled;
  collider?: Collider;
  armor?: Armor;
  destroyed?: Destroyed;
  building?: Building;
  producer?: Producer;
}

export function copyTransform(t: Transform): Transform {
  return { x: t.x, y: t.y, z: t.z, rot: t.rot };
}
