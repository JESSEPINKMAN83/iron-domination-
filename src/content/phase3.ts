export type StructureKind = 'power-plant' | 'refinery' | 'barracks' | 'factory' | 'helipad';
export type UnitKind = 'infantry' | 'tank' | 'vulture';

export interface StructureDef {
  kind: StructureKind;
  label: string;
  tab: 'structures';
  cost: number;
  buildTime: number;
  footprint: { w: number; h: number };
  powerProduced: number;
  powerUsed: number;
  requires?: StructureKind;
  producer?: 'structures' | 'infantry' | 'vehicles' | 'aircraft';
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
