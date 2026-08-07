import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  PointsMaterial,
} from 'three';
import type { Weather } from '../content/atmosphereVariants';
import type { Heightfield } from '../sim/heightfield';

const RAIN_COUNT_BASE = 3200;
const SNOW_COUNT_BASE = 2400;

/**
 * World-anchored precipitation over the full battlefield. Particles fall and
 * recycle in map space so they stay put when the camera pans.
 */
export class WeatherView {
  readonly rain: Points;
  readonly snow: Points;
  private readonly rainPositions: Float32Array;
  private readonly snowPositions: Float32Array;
  private readonly rainSpeeds: Float32Array;
  private readonly snowSpeeds: Float32Array;
  private readonly snowPhase: Float32Array;
  private readonly rainCount: number;
  private readonly snowCount: number;
  private readonly half: number;
  private readonly yMin: number;
  private readonly yMax: number;
  private density = 0;
  private mode: Weather = 'clear';
  private readonly rainColor = new Color(0xb8c4cc);
  private readonly snowColor = new Color(0xeef4f8);

  constructor(hf: Heightfield, mobile = false) {
    const areaScale = Math.max(0.75, Math.min(1.45, (hf.size / 1024) ** 2));
    const mobileScale = mobile ? 0.5 : 1;
    this.rainCount = Math.max(800, Math.floor(RAIN_COUNT_BASE * areaScale * mobileScale));
    this.snowCount = Math.max(600, Math.floor(SNOW_COUNT_BASE * areaScale * mobileScale));
    this.half = hf.size / 2;
    this.yMin = hf.waterLevel + 6;
    this.yMax = hf.maxHeight + 96;
    this.rainPositions = new Float32Array(this.rainCount * 3);
    this.snowPositions = new Float32Array(this.snowCount * 3);
    this.rainSpeeds = new Float32Array(this.rainCount);
    this.snowSpeeds = new Float32Array(this.snowCount);
    this.snowPhase = new Float32Array(this.snowCount);
    seedWorld(this.rainPositions, this.rainSpeeds, this.rainCount, this.half, this.yMin, this.yMax, 48, 28);
    seedWorld(this.snowPositions, this.snowSpeeds, this.snowCount, this.half, this.yMin, this.yMax, 5.5, 8);
    for (let i = 0; i < this.snowCount; i++) this.snowPhase[i] = Math.random() * Math.PI * 2;

    this.rain = createPoints(this.rainPositions, {
      size: mobile ? 1.6 : 1.9,
      opacity: 0.35,
      color: this.rainColor,
    });
    this.rain.visible = false;

    this.snow = createPoints(this.snowPositions, {
      size: mobile ? 1.8 : 2.2,
      opacity: 0.78,
      color: this.snowColor,
    });
    this.snow.visible = false;
  }

  setWeather(weather: Weather): void {
    this.mode = weather;
    if (weather === 'clear') this.density = 0;
  }

  setDensity(density: number): void {
    this.density = Math.max(0, Math.min(1, density));
  }

  setFogTint(color: Color): void {
    this.rainColor.copy(color).lerp(new Color(0xb8c4cc), 0.35);
    (this.rain.material as PointsMaterial).color.copy(this.rainColor);
    this.snowColor.copy(color).lerp(new Color(0xeef4f8), 0.55);
    (this.snow.material as PointsMaterial).color.copy(this.snowColor);
  }

  update(dt: number, _camera: unknown, timeSeconds: number): void {
    const showRain = this.mode === 'rain' && this.density > 0.01;
    const showSnow = this.mode === 'snow' && this.density > 0.01;
    this.rain.visible = showRain;
    this.snow.visible = showSnow;
    if (!showRain && !showSnow) return;

    if (showRain) {
      (this.rain.material as PointsMaterial).opacity = 0.35 * this.density;
      advanceWorld(
        this.rainPositions,
        this.rainSpeeds,
        this.rainCount,
        this.half,
        this.yMin,
        this.yMax,
        dt,
        dt * 9,
        0,
        timeSeconds,
      );
      (this.rain.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    }
    if (showSnow) {
      (this.snow.material as PointsMaterial).opacity = 0.78 * this.density;
      advanceWorld(
        this.snowPositions,
        this.snowSpeeds,
        this.snowCount,
        this.half,
        this.yMin,
        this.yMax,
        dt,
        dt * 2.2,
        1,
        timeSeconds,
        this.snowPhase,
      );
      (this.snow.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.rain.geometry.dispose();
    (this.rain.material as PointsMaterial).dispose();
    this.snow.geometry.dispose();
    (this.snow.material as PointsMaterial).dispose();
  }
}

function createPoints(
  positions: Float32Array,
  opts: { size: number; opacity: number; color: Color },
): Points {
  const geometry = new BufferGeometry();
  const attribute = new BufferAttribute(positions, 3);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const material = new PointsMaterial({
    color: opts.color,
    size: opts.size,
    opacity: opts.opacity,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    blending: NormalBlending,
    toneMapped: false,
    fog: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 40;
  return points;
}

function seedWorld(
  positions: Float32Array,
  speeds: Float32Array,
  count: number,
  half: number,
  yMin: number,
  yMax: number,
  speedMin: number,
  speedSpread: number,
): void {
  const span = Math.max(8, yMax - yMin);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    positions[o] = (Math.random() * 2 - 1) * half;
    positions[o + 1] = yMin + Math.random() * span;
    positions[o + 2] = (Math.random() * 2 - 1) * half;
    speeds[i] = speedMin + Math.random() * speedSpread;
  }
}

function advanceWorld(
  positions: Float32Array,
  speeds: Float32Array,
  count: number,
  half: number,
  yMin: number,
  yMax: number,
  dt: number,
  shear: number,
  mode: 0 | 1,
  time: number,
  phase?: Float32Array,
): void {
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (mode === 1 && phase) {
      positions[o] += Math.sin(time * 1.1 + phase[i]) * 0.045;
      positions[o + 2] += Math.cos(time * 0.85 + phase[i] * 1.7) * 0.038;
    } else {
      positions[o] += shear * 0.12;
    }
    positions[o + 1] -= speeds[i] * dt;
    if (positions[o + 1] < yMin) {
      positions[o] = (Math.random() * 2 - 1) * half;
      positions[o + 1] = yMax;
      positions[o + 2] = (Math.random() * 2 - 1) * half;
    }
    if (positions[o] > half) positions[o] = -half;
    else if (positions[o] < -half) positions[o] = half;
    if (positions[o + 2] > half) positions[o + 2] = -half;
    else if (positions[o + 2] < -half) positions[o + 2] = half;
  }
}
