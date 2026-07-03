export type StructureKind = 'power-plant' | 'refinery' | 'barracks' | 'factory';
export type UnitKind = 'infantry' | 'tank';

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
  producer?: 'structures' | 'infantry' | 'vehicles';
}

export interface UnitDef {
  kind: UnitKind;
  label: string;
  tab: 'infantry' | 'vehicles';
  cost: number;
  buildTime: number;
  requires: StructureKind;
  producer: 'infantry' | 'vehicles';
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
};
