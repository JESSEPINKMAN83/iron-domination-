import { Color, Vector3 } from 'three';
import type { MapAtmosphere } from '../content/maps';

const TRANSITION_SECONDS = 1.8;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColorHex(a: string, b: string, t: number, out: Color): Color {
  return out.set(a).lerp(new Color(b), t);
}

function unpackHex(n: number): Color {
  return new Color((n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

function packColor(c: Color): number {
  return (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
}

export interface AtmosphereSnapshot {
  atmosphere: MapAtmosphere;
  accentEmissiveMul: number;
}

export type AtmosphereApplyFn = (snapshot: AtmosphereSnapshot, weatherDensity: number) => void;

/**
 * Smoothly lerps resolved atmosphere values over ~1.8s when the player
 * switches time-of-day or weather from the in-game menu.
 */
export class AtmosphereTransition {
  private from?: AtmosphereSnapshot;
  private to?: AtmosphereSnapshot;
  private elapsed = 0;
  private active = false;
  private weatherFrom = 0;
  private weatherTo = 0;
  private readonly tmpA = new Color();
  private readonly tmpB = new Color();
  private readonly tmpC = new Color();
  private readonly current: AtmosphereSnapshot = {
    atmosphere: emptyAtmosphere(),
    accentEmissiveMul: 1,
  };

  start(from: AtmosphereSnapshot, to: AtmosphereSnapshot, weatherFrom: number, weatherTo: number): void {
    this.from = cloneSnapshot(from);
    this.to = cloneSnapshot(to);
    this.weatherFrom = weatherFrom;
    this.weatherTo = weatherTo;
    this.elapsed = 0;
    this.active = true;
    copySnapshot(this.current, this.from);
  }

  /** Instantly snap without a transition (match start). */
  snap(to: AtmosphereSnapshot, weatherDensity: number, apply: AtmosphereApplyFn): void {
    this.active = false;
    this.from = undefined;
    this.to = undefined;
    copySnapshot(this.current, to);
    apply(cloneSnapshot(to), weatherDensity);
  }

  get isActive(): boolean {
    return this.active;
  }

  get currentSnapshot(): AtmosphereSnapshot {
    return cloneSnapshot(this.current);
  }

  update(dt: number, apply: AtmosphereApplyFn): void {
    if (!this.active || !this.from || !this.to) return;
    this.elapsed += dt;
    const t = easeInOut(Math.min(1, this.elapsed / TRANSITION_SECONDS));
    mixSnapshot(this.current, this.from, this.to, t, this.tmpA, this.tmpB, this.tmpC);
    const weatherDensity = lerp(this.weatherFrom, this.weatherTo, t);
    apply(cloneSnapshot(this.current), weatherDensity);
    if (t >= 1) {
      this.active = false;
      copySnapshot(this.current, this.to);
    }
  }
}

function emptyAtmosphere(): MapAtmosphere {
  return {
    sky: '#000000',
    skyZenith: '#000000',
    skyHorizon: '#000000',
    sunGlow: '#000000',
    sunStrength: 1,
    sunColor: '#ffffff',
    sunDirection: [0, -1, 0],
    exposure: 1,
    fogNear: 650,
    fogFar: 1900,
    hemisphereSky: 0xffffff,
    hemisphereGround: 0x000000,
    hemisphereIntensity: 1,
    cloudLight: '#ffffff',
    cloudShade: '#000000',
    cloudSoftness: 1,
    cloudWindX: 0,
    cloudWindZ: 0,
    lowClouds: { clusters: 0, puffsPerCluster: 0, altitudeMin: 0, altitudeMax: 0, radiusMin: 0, radiusMax: 0, thicknessMin: 0, thicknessMax: 0, opacity: 0 },
    highClouds: { clusters: 0, puffsPerCluster: 0, altitudeMin: 0, altitudeMax: 0, radiusMin: 0, radiusMax: 0, thicknessMin: 0, thicknessMax: 0, opacity: 0 },
    waterDeep: '#000000',
    waterShallow: '#000000',
  };
}

function cloneSnapshot(source: AtmosphereSnapshot): AtmosphereSnapshot {
  return {
    atmosphere: {
      ...source.atmosphere,
      sunDirection: [...source.atmosphere.sunDirection] as [number, number, number],
      lowClouds: { ...source.atmosphere.lowClouds },
      highClouds: { ...source.atmosphere.highClouds },
    },
    accentEmissiveMul: source.accentEmissiveMul,
  };
}

function copySnapshot(target: AtmosphereSnapshot, source: AtmosphereSnapshot): void {
  Object.assign(target.atmosphere, source.atmosphere);
  target.atmosphere.sunDirection = [...source.atmosphere.sunDirection] as [number, number, number];
  target.atmosphere.lowClouds = { ...source.atmosphere.lowClouds };
  target.atmosphere.highClouds = { ...source.atmosphere.highClouds };
  target.accentEmissiveMul = source.accentEmissiveMul;
}

function mixSnapshot(
  out: AtmosphereSnapshot,
  from: AtmosphereSnapshot,
  to: AtmosphereSnapshot,
  t: number,
  tmpA: Color,
  tmpB: Color,
  tmpC: Color,
): void {
  const a = from.atmosphere;
  const b = to.atmosphere;
  const o = out.atmosphere;
  o.sky = `#${lerpColorHex(a.sky, b.sky, t, tmpA).getHexString()}`;
  o.skyZenith = `#${lerpColorHex(a.skyZenith, b.skyZenith, t, tmpA).getHexString()}`;
  o.skyHorizon = `#${lerpColorHex(a.skyHorizon, b.skyHorizon, t, tmpA).getHexString()}`;
  o.sunGlow = `#${lerpColorHex(a.sunGlow, b.sunGlow, t, tmpA).getHexString()}`;
  o.sunColor = `#${lerpColorHex(a.sunColor, b.sunColor, t, tmpA).getHexString()}`;
  o.cloudLight = `#${lerpColorHex(a.cloudLight, b.cloudLight, t, tmpA).getHexString()}`;
  o.cloudShade = `#${lerpColorHex(a.cloudShade, b.cloudShade, t, tmpA).getHexString()}`;
  o.waterDeep = `#${lerpColorHex(a.waterDeep, b.waterDeep, t, tmpA).getHexString()}`;
  o.waterShallow = `#${lerpColorHex(a.waterShallow, b.waterShallow, t, tmpA).getHexString()}`;
  o.hemisphereSky = packColor(unpackHex(a.hemisphereSky).lerp(unpackHex(b.hemisphereSky), t));
  o.hemisphereGround = packColor(unpackHex(a.hemisphereGround).lerp(unpackHex(b.hemisphereGround), t));
  o.sunStrength = lerp(a.sunStrength, b.sunStrength, t);
  o.exposure = lerp(a.exposure, b.exposure, t);
  o.hemisphereIntensity = lerp(a.hemisphereIntensity, b.hemisphereIntensity, t);
  o.fogNear = lerp(a.fogNear, b.fogNear, t);
  o.fogFar = lerp(a.fogFar, b.fogFar, t);
  o.cloudSoftness = lerp(a.cloudSoftness, b.cloudSoftness, t);
  o.sunDirection = [
    lerp(a.sunDirection[0], b.sunDirection[0], t),
    lerp(a.sunDirection[1], b.sunDirection[1], t),
    lerp(a.sunDirection[2], b.sunDirection[2], t),
  ];
  out.accentEmissiveMul = lerp(from.accentEmissiveMul, to.accentEmissiveMul, t);
  void tmpB;
  void tmpC;
}

export function weatherDensityFor(weather: 'clear' | 'rain' | 'snow'): number {
  return weather === 'clear' ? 0 : 1;
}

export function sunDirectionVector(direction: readonly [number, number, number], out = new Vector3()): Vector3 {
  return out.set(direction[0], direction[1], direction[2]).normalize();
}
