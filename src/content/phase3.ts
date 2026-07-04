import type { WeaponKind } from './phase4';

export type StructureKind = 'power-plant' | 'refinery' | 'barracks' | 'factory' | 'helipad' | 'wall' | 'guard-tower' | 'aa-tower';
export type UnitKind = 'infantry' | 'grenadier' | 'rocket-infantry' | 'scout-tank' | 'tank' | 'siege-tank' | 'wasp' | 'vulture' | 'hammerhead';

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
  role: string;
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
    role: 'Cheap anti-infantry screen',
    tab: 'infantry',
    cost: 100,
    buildTime: 4,
    requires: 'barracks',
    producer: 'infantry',
  },
  grenadier: {
    kind: 'grenadier',
    label: 'Grenadier',
    role: 'Arcing splash, strong versus buildings',
    tab: 'infantry',
    cost: 160,
    buildTime: 5,
    requires: 'barracks',
    producer: 'infantry',
  },
  'rocket-infantry': {
    kind: 'rocket-infantry',
    label: 'Rocket Team',
    role: 'Anti-armor rockets plus AA lock',
    tab: 'infantry',
    cost: 240,
    buildTime: 6,
    requires: 'barracks',
    producer: 'infantry',
  },
  'scout-tank': {
    kind: 'scout-tank',
    label: 'Jackal Scout',
    role: 'Fast scout with single bomb',
    tab: 'vehicles',
    cost: 360,
    buildTime: 7,
    requires: 'factory',
    producer: 'vehicles',
  },
  tank: {
    kind: 'tank',
    label: 'M-17 Tank',
    role: 'Balanced armor with twin bombs',
    tab: 'vehicles',
    cost: 550,
    buildTime: 9,
    requires: 'factory',
    producer: 'vehicles',
  },
  'siege-tank': {
    kind: 'siege-tank',
    label: 'Mauler Siege',
    role: 'Heavy cannon with four-bomb salvo',
    tab: 'vehicles',
    cost: 820,
    buildTime: 12,
    requires: 'factory',
    producer: 'vehicles',
  },
  wasp: {
    kind: 'wasp',
    label: 'Wasp Scout',
    role: 'Fast interceptor with single bomb',
    tab: 'aircraft',
    cost: 650,
    buildTime: 9,
    requires: 'helipad',
    producer: 'aircraft',
  },
  vulture: {
    kind: 'vulture',
    label: 'Vulture',
    role: 'Rocket gunship with twin bombs',
    tab: 'aircraft',
    cost: 950,
    buildTime: 12,
    requires: 'helipad',
    producer: 'aircraft',
  },
  hammerhead: {
    kind: 'hammerhead',
    label: 'Hammerhead',
    role: 'Heavy aircraft with four-bomb salvo',
    tab: 'aircraft',
    cost: 1250,
    buildTime: 15,
    requires: 'helipad',
    producer: 'aircraft',
  },
};
