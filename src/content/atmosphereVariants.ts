import type { MapAtmosphere } from './maps';

export type TimeOfDay = 'day' | 'sunset' | 'night';
export type Weather = 'clear' | 'rain' | 'snow';

export const TIME_OF_DAY_IDS: TimeOfDay[] = ['day', 'sunset', 'night'];
export const WEATHER_IDS: Weather[] = ['clear', 'rain', 'snow'];

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  day: 'Day',
  sunset: 'Sunset',
  night: 'Night',
};

export const WEATHER_LABELS: Record<Weather, string> = {
  clear: 'Clear',
  rain: 'Rain',
  snow: 'Snow',
};

/** Partial atmosphere blend recipe layered onto a map's base look. */
export interface AtmosphereModifier {
  skyTint?: string;
  skyTintWeight?: number;
  skyZenithTint?: string;
  skyZenithTintWeight?: number;
  skyHorizonTint?: string;
  skyHorizonTintWeight?: number;
  sunGlowTint?: string;
  sunGlowTintWeight?: number;
  sunColorTint?: string;
  sunColorTintWeight?: number;
  hemisphereSkyTint?: number;
  hemisphereSkyTintWeight?: number;
  hemisphereGroundTint?: number;
  hemisphereGroundTintWeight?: number;
  cloudLightTint?: string;
  cloudLightTintWeight?: number;
  cloudShadeTint?: string;
  cloudShadeTintWeight?: number;
  sunStrengthMul?: number;
  exposureMul?: number;
  hemisphereIntensityMul?: number;
  fogNearMul?: number;
  fogFarMul?: number;
  cloudSoftness?: number;
  sunDirection?: readonly [number, number, number];
  /** Night readability: own-team accent emissive multiplier. */
  accentEmissiveMul?: number;
  /** Night readability floor for hemisphere intensity after modifiers. */
  hemisphereIntensityFloor?: number;
}

export const TIME_OF_DAY: Record<TimeOfDay, AtmosphereModifier> = {
  day: {},
  sunset: {
    skyTint: '#d18a55',
    skyTintWeight: 0.55,
    skyZenithTint: '#704f68',
    skyZenithTintWeight: 0.45,
    skyHorizonTint: '#f2a35d',
    skyHorizonTintWeight: 0.5,
    sunGlowTint: '#ffd08a',
    sunGlowTintWeight: 0.7,
    sunColorTint: '#ffbd73',
    sunColorTintWeight: 0.85,
    hemisphereSkyTint: 0xffc98e,
    hemisphereSkyTintWeight: 0.55,
    hemisphereGroundTint: 0x593528,
    hemisphereGroundTintWeight: 0.35,
    cloudLightTint: '#fff0d1',
    cloudLightTintWeight: 0.4,
    cloudShadeTint: '#caa77c',
    cloudShadeTintWeight: 0.45,
    sunStrengthMul: 1.05,
    exposureMul: 1.05,
    fogNearMul: 0.9,
    fogFarMul: 0.92,
    sunDirection: [-0.86, -0.3, -0.38],
  },
  night: {
    skyTint: '#101a2c',
    skyTintWeight: 0.82,
    skyZenithTint: '#0a1220',
    skyZenithTintWeight: 0.78,
    skyHorizonTint: '#1a2740',
    skyHorizonTintWeight: 0.7,
    sunGlowTint: '#c5d6ff',
    sunGlowTintWeight: 0.65,
    sunColorTint: '#9db8ff',
    sunColorTintWeight: 0.9,
    hemisphereSkyTint: 0x31435e,
    hemisphereSkyTintWeight: 0.85,
    hemisphereGroundTint: 0x1c2230,
    hemisphereGroundTintWeight: 0.8,
    cloudLightTint: '#3a4a62',
    cloudLightTintWeight: 0.7,
    cloudShadeTint: '#1c2535',
    cloudShadeTintWeight: 0.75,
    sunStrengthMul: 0.22,
    exposureMul: 0.9,
    hemisphereIntensityMul: 0.85,
    fogNearMul: 0.7,
    fogFarMul: 0.82,
    sunDirection: [-0.35, -0.92, -0.18],
    accentEmissiveMul: 2.2,
    hemisphereIntensityFloor: 0.55,
  },
};

export const WEATHER: Record<Weather, AtmosphereModifier> = {
  clear: {},
  rain: {
    skyTint: '#77828c',
    skyTintWeight: 0.55,
    skyZenithTint: '#5f6a74',
    skyZenithTintWeight: 0.5,
    skyHorizonTint: '#8b959e',
    skyHorizonTintWeight: 0.45,
    hemisphereSkyTint: 0x77828c,
    hemisphereSkyTintWeight: 0.5,
    hemisphereGroundTint: 0x4a524c,
    hemisphereGroundTintWeight: 0.35,
    cloudLightTint: '#9aa4ac',
    cloudLightTintWeight: 0.55,
    cloudShadeTint: '#4e575f',
    cloudShadeTintWeight: 0.7,
    sunStrengthMul: 0.55,
    fogNearMul: 0.55,
    fogFarMul: 0.7,
    cloudSoftness: 0.2,
  },
  snow: {
    skyTint: '#c9d4dc',
    skyTintWeight: 0.6,
    skyZenithTint: '#a8b8c6',
    skyZenithTintWeight: 0.5,
    skyHorizonTint: '#e8eef2',
    skyHorizonTintWeight: 0.55,
    hemisphereSkyTint: 0xeaf7ff,
    hemisphereSkyTintWeight: 0.45,
    hemisphereGroundTint: 0xc5d0d8,
    hemisphereGroundTintWeight: 0.55,
    cloudLightTint: '#eaf1f4',
    cloudLightTintWeight: 0.5,
    cloudShadeTint: '#98a8b4',
    cloudShadeTintWeight: 0.45,
    sunStrengthMul: 0.7,
    fogNearMul: 0.5,
    fogFarMul: 0.6,
    hemisphereIntensityMul: 1.08,
  },
};

export function sanitizeTimeOfDay(value: unknown): TimeOfDay | undefined {
  return TIME_OF_DAY_IDS.includes(value as TimeOfDay) ? (value as TimeOfDay) : undefined;
}

export function sanitizeWeather(value: unknown): Weather | undefined {
  return WEATHER_IDS.includes(value as Weather) ? (value as Weather) : undefined;
}

export function cloneAtmosphere(source: MapAtmosphere): MapAtmosphere {
  return {
    ...source,
    sunDirection: [...source.sunDirection] as [number, number, number],
    lowClouds: { ...source.lowClouds },
    highClouds: { ...source.highClouds },
  };
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mixHexColor(base: string, tint: string | undefined, weight: number | undefined): string {
  if (!tint || !weight || weight <= 0) return base;
  const t = Math.max(0, Math.min(1, weight));
  const from = parseColor(base);
  const to = parseColor(tint);
  const r = lerpChannel(from.r, to.r, t);
  const g = lerpChannel(from.g, to.g, t);
  const b = lerpChannel(from.b, to.b, t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function mixPackedColor(base: number, tint: number | undefined, weight: number | undefined): number {
  if (tint === undefined || !weight || weight <= 0) return base;
  const t = Math.max(0, Math.min(1, weight));
  const br = (base >> 16) & 0xff;
  const bg = (base >> 8) & 0xff;
  const bb = base & 0xff;
  const tr = (tint >> 16) & 0xff;
  const tg = (tint >> 8) & 0xff;
  const tb = tint & 0xff;
  return (lerpChannel(br, tr, t) << 16) | (lerpChannel(bg, tg, t) << 8) | lerpChannel(bb, tb, t);
}

function parseColor(value: string): { r: number; g: number; b: number } {
  const hex = value.startsWith('#') ? value.slice(1) : value;
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function applyModifier(target: MapAtmosphere, mod: AtmosphereModifier): void {
  target.sky = mixHexColor(target.sky, mod.skyTint, mod.skyTintWeight);
  target.skyZenith = mixHexColor(target.skyZenith, mod.skyZenithTint, mod.skyZenithTintWeight);
  target.skyHorizon = mixHexColor(target.skyHorizon, mod.skyHorizonTint, mod.skyHorizonTintWeight);
  target.sunGlow = mixHexColor(target.sunGlow, mod.sunGlowTint, mod.sunGlowTintWeight);
  target.sunColor = mixHexColor(target.sunColor, mod.sunColorTint, mod.sunColorTintWeight);
  target.cloudLight = mixHexColor(target.cloudLight, mod.cloudLightTint, mod.cloudLightTintWeight);
  target.cloudShade = mixHexColor(target.cloudShade, mod.cloudShadeTint, mod.cloudShadeTintWeight);
  target.hemisphereSky = mixPackedColor(target.hemisphereSky, mod.hemisphereSkyTint, mod.hemisphereSkyTintWeight);
  target.hemisphereGround = mixPackedColor(target.hemisphereGround, mod.hemisphereGroundTint, mod.hemisphereGroundTintWeight);
  if (mod.sunStrengthMul !== undefined) target.sunStrength *= mod.sunStrengthMul;
  if (mod.exposureMul !== undefined) target.exposure *= mod.exposureMul;
  if (mod.hemisphereIntensityMul !== undefined) target.hemisphereIntensity *= mod.hemisphereIntensityMul;
  if (mod.fogNearMul !== undefined) target.fogNear *= mod.fogNearMul;
  if (mod.fogFarMul !== undefined) target.fogFar *= mod.fogFarMul;
  if (mod.cloudSoftness !== undefined) target.cloudSoftness = mod.cloudSoftness;
  if (mod.sunDirection) target.sunDirection = [...mod.sunDirection] as [number, number, number];
  if (mod.hemisphereIntensityFloor !== undefined) {
    target.hemisphereIntensity = Math.max(target.hemisphereIntensity, mod.hemisphereIntensityFloor);
  }
}

export interface ResolvedAtmosphereExtras {
  accentEmissiveMul: number;
}

/** Blend map atmosphere with time-of-day then weather. day+clear is identity. */
export function resolveAtmosphere(
  mapAtmosphere: MapAtmosphere,
  timeOfDay: TimeOfDay = 'day',
  weather: Weather = 'clear',
): { atmosphere: MapAtmosphere; extras: ResolvedAtmosphereExtras } {
  const atmosphere = cloneAtmosphere(mapAtmosphere);
  const timeMod = TIME_OF_DAY[timeOfDay] ?? TIME_OF_DAY.day;
  const weatherMod = WEATHER[weather] ?? WEATHER.clear;
  applyModifier(atmosphere, timeMod);
  applyModifier(atmosphere, weatherMod);
  return {
    atmosphere,
    extras: {
      accentEmissiveMul: timeMod.accentEmissiveMul ?? 1,
    },
  };
}

export function atmospheresEqual(a: MapAtmosphere, b: MapAtmosphere): boolean {
  return (
    a.sky === b.sky &&
    a.skyZenith === b.skyZenith &&
    a.skyHorizon === b.skyHorizon &&
    a.sunGlow === b.sunGlow &&
    a.sunStrength === b.sunStrength &&
    a.sunColor === b.sunColor &&
    a.sunDirection[0] === b.sunDirection[0] &&
    a.sunDirection[1] === b.sunDirection[1] &&
    a.sunDirection[2] === b.sunDirection[2] &&
    a.exposure === b.exposure &&
    a.fogNear === b.fogNear &&
    a.fogFar === b.fogFar &&
    a.hemisphereSky === b.hemisphereSky &&
    a.hemisphereGround === b.hemisphereGround &&
    a.hemisphereIntensity === b.hemisphereIntensity &&
    a.cloudLight === b.cloudLight &&
    a.cloudShade === b.cloudShade &&
    a.cloudSoftness === b.cloudSoftness
  );
}
