import type { MapConfig } from '../sim/heightfield';

export type MapId = 'highlands' | 'crater-oasis' | 'frostbite-pass';

export type MapBiome = 'temperate' | 'desert' | 'snow';

export type MapSize = 'small' | 'medium' | 'large';

export interface MapSizePreset {
  id: MapSize;
  label: string;
  cells: number;
  oreMultiplier: number;
  description: string;
}

export interface MapAtmosphere {
  sky: string;
  fogNear: number;
  fogFar: number;
  hemisphereSky: number;
  hemisphereGround: number;
  hemisphereIntensity: number;
  waterDeep: string;
  waterShallow: string;
}

export interface MapPreset {
  id: MapId;
  label: string;
  shortLabel: string;
  description: string;
  biome: MapBiome;
  atmosphere: MapAtmosphere;
  config: MapConfig;
}

export const MAP_PRESETS = {
  highlands: {
    id: 'highlands',
    label: 'Highlands',
    shortLabel: 'HIGHLANDS',
    description: 'Rolling green plateaus, lakes, trees, and balanced oil fields. The classic Iron Dominion battlefield.',
    biome: 'temperate',
    atmosphere: {
      sky: '#8fb3d6',
      fogNear: 650,
      fogFar: 1900,
      hemisphereSky: 0xcfe0f2,
      hemisphereGround: 0x8a795d,
      hemisphereIntensity: 0.75,
      waterDeep: '#061a24',
      waterShallow: '#296b6b',
    },
    config: {
      kind: 'highlands',
      seed: 1337,
      cells: 512,
      cellSize: 2,
      waterLevel: 2.0,
      oreFieldCount: 5,
    },
  },
  'crater-oasis': {
    id: 'crater-oasis',
    label: 'Crater Oasis',
    shortLabel: 'CRATER',
    description: 'A sun-baked desert impact basin with a turquoise oasis, scarred sandstone rims, and exposed oil fields in the open.',
    biome: 'desert',
    atmosphere: {
      sky: '#dcbf8b',
      fogNear: 520,
      fogFar: 1500,
      hemisphereSky: 0xffdfaa,
      hemisphereGround: 0x9b7042,
      hemisphereIntensity: 0.88,
      waterDeep: '#073540',
      waterShallow: '#21a5a6',
    },
    config: {
      kind: 'crater-oasis',
      seed: 240771,
      cells: 512,
      cellSize: 2,
      waterLevel: 3.3,
      oreFieldCount: 8,
    },
  },
  'frostbite-pass': {
    id: 'frostbite-pass',
    label: 'Frostbite Pass',
    shortLabel: 'FROST',
    description: 'A frozen mountain corridor with icy lakes, whiteout snow, narrow ridges, and high-value ore trapped in exposed passes.',
    biome: 'snow',
    atmosphere: {
      sky: '#b9cce0',
      fogNear: 360,
      fogFar: 1220,
      hemisphereSky: 0xeaf7ff,
      hemisphereGround: 0x8793a0,
      hemisphereIntensity: 0.96,
      waterDeep: '#23394f',
      waterShallow: '#9bd8e5',
    },
    config: {
      kind: 'frostbite-pass',
      seed: 771204,
      cells: 512,
      cellSize: 2,
      waterLevel: 5.0,
      oreFieldCount: 7,
    },
  },
} as const satisfies Record<MapId, MapPreset>;

export const MAP_IDS = Object.keys(MAP_PRESETS) as MapId[];
export const DEFAULT_MAP_ID: MapId = 'highlands';
export const MAP_SIZE_PRESETS = {
  small: {
    id: 'small',
    label: 'SMALL',
    cells: 384,
    oreMultiplier: 0.75,
    description: '768m battlefield. Faster contact and focused 1v1 matches.',
  },
  medium: {
    id: 'medium',
    label: 'MEDIUM',
    cells: 512,
    oreMultiplier: 1,
    description: '1024m battlefield. The current balanced default for 1v1 or 2v2.',
  },
  large: {
    id: 'large',
    label: 'LARGE',
    cells: 640,
    oreMultiplier: 1.25,
    description: '1280m battlefield. More expansion space and longer four-army wars.',
  },
} as const satisfies Record<MapSize, MapSizePreset>;
export const MAP_SIZE_IDS = Object.keys(MAP_SIZE_PRESETS) as MapSize[];
export const DEFAULT_MAP_SIZE: MapSize = 'medium';
export const MAP01: MapConfig = MAP_PRESETS.highlands.config;

export function sanitizeMapId(value: unknown): MapId | undefined {
  return typeof value === 'string' && value in MAP_PRESETS ? (value as MapId) : undefined;
}

export function sanitizeMapSize(value: unknown): MapSize | undefined {
  return typeof value === 'string' && value in MAP_SIZE_PRESETS ? (value as MapSize) : undefined;
}

export function mapConfig(id: MapId, size: MapSize = DEFAULT_MAP_SIZE): MapConfig {
  const base = MAP_PRESETS[id]?.config ?? MAP_PRESETS[DEFAULT_MAP_ID].config;
  const selectedSize = MAP_SIZE_PRESETS[size] ?? MAP_SIZE_PRESETS[DEFAULT_MAP_SIZE];
  return {
    ...base,
    cells: selectedSize.cells,
    oreFieldCount: Math.max(3, Math.round(base.oreFieldCount * selectedSize.oreMultiplier)),
  };
}
