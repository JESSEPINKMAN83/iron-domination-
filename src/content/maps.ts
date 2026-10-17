import type { MapConfig, TerrainLayout } from '../sim/heightfield';

export type MapId = 'highlands' | 'crater-oasis' | 'frostbite-pass' | 'natanz';

export type MapBiome = 'temperate' | 'desert' | 'snow';

export type MapSize = 'small' | 'medium' | 'large';

export const ORE_AMOUNT_MIN = 50;
export const ORE_AMOUNT_MAX = 400;
export const ORE_AMOUNT_STEP = 25;
export const DEFAULT_ORE_AMOUNT = 100;
export const TERRAIN_RELIEF_MIN = 50;
export const TERRAIN_RELIEF_MAX = 150;
export const TERRAIN_RELIEF_STEP = 25;

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
  sunColor: string;
  /** Direction light travels, from the sun toward the battlefield. */
  sunDirection: readonly [number, number, number];
  exposure: number;
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
    label: 'Golan Heights',
    shortLabel: 'GOLAN',
    description: 'Green basalt mountains above the Sea of Galilee: oak woodland, olive groves, steep ridges and balanced oil fields. The classic Code Red front.',
    biome: 'temperate',
    atmosphere: {
      sky: '#8fb3d6',
      skyZenith: '#4f91cc',
      skyHorizon: '#d7e9f4',
      sunGlow: '#fff1bd',
      sunStrength: 0.82,
      sunColor: '#fff3d2',
      sunDirection: [-0.5, -0.85, -0.32],
      exposure: 1.08,
      fogNear: 650,
      fogFar: 1900,
      hemisphereSky: 0xcfe0f2,
      hemisphereGround: 0x7d7a58,
      hemisphereIntensity: 0.75,
      cloudLight: '#fffdf4',
      cloudShade: '#d8e4eb',
      cloudSoftness: 1,
      cloudWindX: 0.58,
      cloudWindZ: 0.16,
      lowClouds: {
        clusters: 9,
        puffsPerCluster: 8,
        altitudeMin: 108,
        altitudeMax: 128,
        radiusMin: 28,
        radiusMax: 54,
        thicknessMin: 7,
        thicknessMax: 12,
        opacity: 0.24,
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
      waterDeep: '#0b3442',
      waterShallow: '#347c78',
    },
    config: {
      kind: 'highlands',
      seed: 1337,
      cells: 512,
      cellSize: 2,
      waterLevel: 2.0,
      oreFieldCount: 5,
      terrainRelief: 125,
    },
  },
  'crater-oasis': {
    id: 'crater-oasis',
    label: 'Negev',
    shortLabel: 'NEGEV',
    description: 'A sun-baked Negev crater with a turquoise oasis, scarred sandstone rims and exposed oil fields in the open.',
    biome: 'desert',
    atmosphere: {
      sky: '#d18a55',
      skyZenith: '#704f68',
      skyHorizon: '#f2a35d',
      sunGlow: '#ffd08a',
      sunStrength: 1.12,
      sunColor: '#ffbd73',
      sunDirection: [-0.86, -0.34, -0.38],
      exposure: 1.14,
      fogNear: 560,
      fogFar: 1650,
      hemisphereSky: 0xffc98e,
      hemisphereGround: 0x593528,
      hemisphereIntensity: 0.68,
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
      terrainRelief: 125,
    },
  },
  'frostbite-pass': {
    id: 'frostbite-pass',
    label: 'Mount Hermon',
    shortLabel: 'HERMON',
    description: 'The snow-covered Hermon ridge: icy lakes, whiteout snow, narrow passes and high-value ore on exposed slopes.',
    biome: 'snow',
    atmosphere: {
      sky: '#b9cce0',
      skyZenith: '#849bad',
      skyHorizon: '#e0e8ed',
      sunGlow: '#eef7fb',
      sunStrength: 0.42,
      sunColor: '#eaf4ff',
      sunDirection: [-0.42, -0.78, -0.46],
      exposure: 1.03,
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
      terrainRelief: 100,
    },
  },
  natanz: {
    id: 'natanz',
    label: 'Natanz Plateau',
    shortLabel: 'NATANZ',
    description: 'Iran’s high desert below the Karkas range: a fortified central mesa, dry wadis and wide open ground with no water to hide behind.',
    biome: 'desert',
    atmosphere: {
      sky: '#c9c3b2',
      skyZenith: '#6f93b4',
      skyHorizon: '#e8dcc2',
      sunGlow: '#fff2cf',
      sunStrength: 0.95,
      sunColor: '#fff4dc',
      sunDirection: [-0.38, -0.9, -0.22],
      exposure: 1.06,
      fogNear: 520,
      fogFar: 1700,
      hemisphereSky: 0xe5ddc8,
      hemisphereGround: 0xa08462,
      hemisphereIntensity: 0.82,
      cloudLight: '#fbf6ea',
      cloudShade: '#d6cdbb',
      cloudSoftness: 1,
      cloudWindX: 0.62,
      cloudWindZ: 0.1,
      lowClouds: {
        clusters: 5,
        puffsPerCluster: 6,
        altitudeMin: 118,
        altitudeMax: 136,
        radiusMin: 26,
        radiusMax: 48,
        thicknessMin: 6,
        thicknessMax: 10,
        opacity: 0.16,
      },
      highClouds: {
        clusters: 8,
        puffsPerCluster: 5,
        altitudeMin: 150,
        altitudeMax: 196,
        radiusMin: 52,
        radiusMax: 96,
        thicknessMin: 5,
        thicknessMax: 9,
        opacity: 0.22,
      },
      waterDeep: '#22424f',
      waterShallow: '#5f9a96',
    },
    config: {
      kind: 'natanz',
      seed: 90210,
      cells: 512,
      cellSize: 2,
      waterLevel: 2.0,
      oreFieldCount: 6,
      terrainRelief: 100,
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

export function sanitizeTerrainRelief(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const relief = Number(value);
  if (!Number.isFinite(relief)) return undefined;
  const stepped = Math.round(relief / TERRAIN_RELIEF_STEP) * TERRAIN_RELIEF_STEP;
  return Math.max(TERRAIN_RELIEF_MIN, Math.min(TERRAIN_RELIEF_MAX, stepped));
}

export function defaultTerrainRelief(id: MapId): number {
  return sanitizeTerrainRelief(MAP_PRESETS[id]?.config.terrainRelief) ?? 100;
}

export function oreFieldCount(id: MapId, size: MapSize = DEFAULT_MAP_SIZE, oreAmount = DEFAULT_ORE_AMOUNT): number {
  const base = MAP_PRESETS[id]?.config ?? MAP_PRESETS[DEFAULT_MAP_ID].config;
  const selectedSize = MAP_SIZE_PRESETS[size] ?? MAP_SIZE_PRESETS[DEFAULT_MAP_SIZE];
  const amount = Math.min(200, sanitizeOreAmount(oreAmount) ?? DEFAULT_ORE_AMOUNT);
  const linearMultiplier = amount / 100;
  const maximumBoost = amount <= 150 ? 0 : 3 * ((amount - 150) / 50) ** 2;
  const abundanceMultiplier = linearMultiplier + maximumBoost;
  return Math.max(2, Math.round(base.oreFieldCount * selectedSize.oreMultiplier * abundanceMultiplier));
}

export function mapConfig(
  id: MapId,
  size: MapSize = DEFAULT_MAP_SIZE,
  oreAmount = DEFAULT_ORE_AMOUNT,
  terrainRelief = defaultTerrainRelief(id),
  terrainLayout: TerrainLayout = 'classic',
): MapConfig {
  const base = MAP_PRESETS[id]?.config ?? MAP_PRESETS[DEFAULT_MAP_ID].config;
  const selectedSize = MAP_SIZE_PRESETS[size] ?? MAP_SIZE_PRESETS[DEFAULT_MAP_SIZE];
  return {
    ...base,
    cells: selectedSize.cells,
    ...(terrainLayout !== 'classic' ? { terrainLayout } : {}),
    ...((sanitizeOreAmount(oreAmount) ?? 100) > 200 ? { oreRichness: (sanitizeOreAmount(oreAmount) ?? 100) / 200 } : {}),
    oreFieldCount: oreFieldCount(id, size, oreAmount),
    terrainRelief: sanitizeTerrainRelief(terrainRelief) ?? defaultTerrainRelief(id),
  };
}
