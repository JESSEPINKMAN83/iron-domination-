import type { FlowField } from './flowfield';

export interface Transform {
  x: number;
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
}

export interface Weapon {
  kind: string;
  range: number;
  cooldown: number;
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

export interface Collider {
  radius: number;
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
  weapon?: Weapon;
  turret?: Turret;
  vision?: Vision;
  cargo?: Cargo;
  builder?: Builder;
  possessable?: Possessable;
  collider?: Collider;
  building?: Building;
  producer?: Producer;
}

export function copyTransform(t: Transform): Transform {
  return { x: t.x, z: t.z, rot: t.rot };
}
