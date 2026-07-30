import type { MapConfig } from '../sim/heightfield';

export type MapId = 'highlands' | 'crater-oasis' | 'frostbite-pass';

export type MapBiome = 'temperate' | 'desert' | 'snow';

export type MapSize = 'small' | 'medium' | 'large';

export const ORE_AMOUNT_MIN = 50;
export const ORE_AMOUNT_MAX = 200;
export const ORE_AMOUNT_STEP = 25;
export const DEFAULT_ORE_AMOUNT = 100;

export interface MapSizePreset {
  id: MapSize;
  label: string;
  cells: number;
  oreMultiplier: number;
  description: string;
}

export interface CloudLayerPreset {
  clusters: number;
  puffsPerCluster: number;
  altitudeMin: number;
  altitudeMax: number;
  radiusMin: number;
  radiusMax: number;
  thicknessMin: number;
  thicknessMax: number;
  opacity: number;
}

export interface MapAtmosphere {
  /** Solid fallback colour used by fog and before the sky shader compiles. */
  sky: string;
  skyZenith: string;
  skyHorizon: string;
  sunGlow: string;
  sunStrength: number;
  fogNear: number;
  fogFar: number;
  hemisphereSky: number;
  hemisphereGround: number;
  hemisphereIntensity: number;
  cloudLight: string;
  cloudShade: string;
  /** 0 keeps a faceted storm-bank silhouette; 1 uses fully rounded puffs. */
  cloudSoftness: number;
  cloudWindX: number;
  cloudWindZ: number;
  lowClouds: CloudLayerPreset;
  highClouds: CloudLayerPreset;
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
      skyZenith: '#4f91cc',
      skyHorizon: '#d7e9f4',
      sunGlow: '#fff1bd',
      sunStrength: 0.82,
      fogNear: 650,
      fogFar: 1900,
      hemisphereSky: 0xcfe0f2,
      hemisphereGround: 0x8a795d,
      hemisphereIntensity: 0.75,
      cloudLight: '#fffdf4',
      cloudShade: '#d8e4eb',
      cloudSoftness: 1,
      cloudWindX: 0.58,
      cloudWindZ: 0.16,
      lowClouds: {
        clusters: 9,
        puffsPerCluster: 8,
        altitudeMin: 46,
        altitudeMax: 70,
        radiusMin: 28,
        radiusMax: 54,
        thicknessMin: 8,
        thicknessMax: 15,
        opacity: 0.43,
      },
      highClouds: {
        clusters: 14,
        puffsPerCluster: 6,
        altitudeMin: 138,
        altitudeMax: 188,
        radiusMin: 48,
        radiusMax: 92,
        thicknessMin: 5,
        thicknessMax: 11,
        opacity: 0.32,
      },
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
      skyZenith: '#5c94b7',
      skyHorizon: '#efd09f',
      sunGlow: '#ffd58b',
      sunStrength: 1.05,
      fogNear: 520,
      fogFar: 1500,
      hemisphereSky: 0xffdfaa,
      hemisphereGround: 0x9b7042,
      hemisphereIntensity: 0.88,
      cloudLight: '#fff0d1',
      cloudShade: '#caa77c',
      cloudSoftness: 0.32,
      cloudWindX: 0.82,
      cloudWindZ: 0.34,
      lowClouds: {
        clusters: 2,
        puffsPerCluster: 4,
        altitudeMin: 64,
        altitudeMax: 80,
        radiusMin: 36,
        radiusMax: 58,
        thicknessMin: 5,
        thicknessMax: 9,
        opacity: 0.3,
      },
      highClouds: {
        clusters: 10,
        puffsPerCluster: 4,
        altitudeMin: 152,
        altitudeMax: 212,
        radiusMin: 66,
        radiusMax: 118,
        thicknessMin: 3,
        thicknessMax: 7,
        opacity: 0.3,
      },
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
      skyZenith: '#849bad',
      skyHorizon: '#e0e8ed',
      sunGlow: '#eef7fb',
      sunStrength: 0.42,
      fogNear: 360,
      fogFar: 1220,
      hemisphereSky: 0xeaf7ff,
      hemisphereGround: 0x8793a0,
      hemisphereIntensity: 0.96,
      cloudLight: '#eaf1f4',
      cloudShade: '#98a8b4',
      cloudSoftness: 0.46,
      cloudWindX: 0.4,
      cloudWindZ: -0.24,
      lowClouds: {
        clusters: 14,
        puffsPerCluster: 8,
        altitudeMin: 42,
        altitudeMax: 68,
        radiusMin: 34,
        radiusMax: 72,
        thicknessMin: 11,
        thicknessMax: 19,
        opacity: 0.72,
      },
      highClouds: {
        clusters: 12,
        puffsPerCluster: 7,
        altitudeMin: 112,
        altitudeMax: 158,
        radiusMin: 68,
        radiusMax: 124,
        thicknessMin: 10,
        thicknessMax: 18,
        opacity: 0.6,
      },
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

export function sanitizeOreAmount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return undefined;
  const stepped = Math.round(amount / ORE_AMOUNT_STEP) * ORE_AMOUNT_STEP;
  return Math.max(ORE_AMOUNT_MIN, Math.min(ORE_AMOUNT_MAX, stepped));
}

export function oreFieldCount(id: MapId, size: MapSize = DEFAULT_MAP_SIZE, oreAmount = DEFAULT_ORE_AMOUNT): number {
  const base = MAP_PRESETS[id]?.config ?? MAP_PRESETS[DEFAULT_MAP_ID].config;
  const selectedSize = MAP_SIZE_PRESETS[size] ?? MAP_SIZE_PRESETS[DEFAULT_MAP_SIZE];
  const amount = sanitizeOreAmount(oreAmount) ?? DEFAULT_ORE_AMOUNT;
  return Math.max(2, Math.round(base.oreFieldCount * selectedSize.oreMultiplier * amount / 100));
}

export function mapConfig(id: MapId, size: MapSize = DEFAULT_MAP_SIZE, oreAmount = DEFAULT_ORE_AMOUNT): MapConfig {
  const base = MAP_PRESETS[id]?.config ?? MAP_PRESETS[DEFAULT_MAP_ID].config;
  const selectedSize = MAP_SIZE_PRESETS[size] ?? MAP_SIZE_PRESETS[DEFAULT_MAP_SIZE];
  return {
    ...base,
    cells: selectedSize.cells,
    oreFieldCount: oreFieldCount(id, size, oreAmount),
  };
}
