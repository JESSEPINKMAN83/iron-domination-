import type { WeaponKind } from './phase4';

export type StructureKind = 'power-plant' | 'refinery' | 'barracks' | 'factory' | 'helipad' | 'wall' | 'guard-tower' | 'aa-tower';
export type UnitKind = 'infantry' | 'tank' | 'vulture';

export interface StructureDef {
  kind: StructureKind;
  label: string;
  tab: 'structures' | 'defense';
  cost: number;
  buildTime: number;
  health?: number;
  footprint: { w: number; h: number };
  powerProduced: number;
  powerUsed: number;
  requires?: StructureKind;
  producer?: 'structures' | 'infantry' | 'vehicles' | 'aircraft';
  blocksMovement?: boolean;
  weaponKind?: WeaponKind;
  weaponRange?: number;
  visionRadius?: number;
}

export interface UnitDef {
  kind: UnitKind;
  label: string;
  tab: 'infantry' | 'vehicles' | 'aircraft';
  cost: number;
  buildTime: number;
  requires: StructureKind;
  producer: 'infantry' | 'vehicles' | 'aircraft';
}

export const STRUCTURES: Record<StructureKind, StructureDef> = {
  'power-plant': {
    kind: 'power-plant',
    label: 'Power Plant',
    tab: 'structures',
    cost: 300,
    buildTime: 4,
    footprint: { w: 5, h: 5 },
    powerProduced: 40,
    powerUsed: 0,
  },
  refinery: {
    kind: 'refinery',
    label: 'Refinery',
    tab: 'structures',
    cost: 800,
    buildTime: 7,
    footprint: { w: 7, h: 6 },
    powerProduced: 0,
    powerUsed: 12,
    requires: 'power-plant',
  },
  barracks: {
    kind: 'barracks',
    label: 'Barracks',
    tab: 'structures',
    cost: 500,
    buildTime: 5,
    footprint: { w: 6, h: 5 },
    powerProduced: 0,
    powerUsed: 8,
    requires: 'power-plant',
    producer: 'infantry',
  },
  factory: {
    kind: 'factory',
    label: 'Factory',
    tab: 'structures',
    cost: 900,
    buildTime: 8,
    footprint: { w: 8, h: 7 },
    powerProduced: 0,
    powerUsed: 18,
    requires: 'refinery',
    producer: 'vehicles',
  },
  helipad: {
    kind: 'helipad',
    label: 'Helipad',
    tab: 'structures',
    cost: 500,
    buildTime: 6,
    footprint: { w: 7, h: 7 },
    powerProduced: 0,
    powerUsed: 10,
    requires: 'factory',
    producer: 'aircraft',
  },
  wall: {
    kind: 'wall',
    label: 'Wall Segment',
    tab: 'defense',
    cost: 80,
    buildTime: 1.4,
    health: 420,
    footprint: { w: 2, h: 2 },
    powerProduced: 0,
    powerUsed: 0,
    requires: 'power-plant',
    blocksMovement: true,
    visionRadius: 0,
  },
  'guard-tower': {
    kind: 'guard-tower',
    label: 'Guard Tower',
    tab: 'defense',
    cost: 650,
    buildTime: 6,
    health: 760,
    footprint: { w: 4, h: 4 },
    powerProduced: 0,
    powerUsed: 6,
    requires: 'power-plant',
    blocksMovement: true,
    weaponKind: 'cannon',
    weaponRange: 88,
    visionRadius: 105,
  },
  'aa-tower': {
    kind: 'aa-tower',
    label: 'AA Missile Tower',
    tab: 'defense',
    cost: 780,
    buildTime: 7,
    health: 680,
    footprint: { w: 4, h: 4 },
    powerProduced: 0,
    powerUsed: 8,
    requires: 'power-plant',
    blocksMovement: true,
    weaponKind: 'aaMissile',
    weaponRange: 145,
    visionRadius: 165,
  },
};

export const UNITS: Record<UnitKind, UnitDef> = {
  infantry: {
    kind: 'infantry',
    label: 'Rifle Team',
    tab: 'infantry',
    cost: 100,
    buildTime: 4,
    requires: 'barracks',
    producer: 'infantry',
  },
  tank: {
    kind: 'tank',
    label: 'M-17 Tank',
    tab: 'vehicles',
    cost: 550,
    buildTime: 9,
    requires: 'factory',
    producer: 'vehicles',
  },
  vulture: {
    kind: 'vulture',
    label: 'Vulture',
    tab: 'aircraft',
    cost: 950,
    buildTime: 12,
    requires: 'helipad',
    producer: 'aircraft',
  },
};
