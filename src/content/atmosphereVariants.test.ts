import { describe, expect, it } from 'vitest';
import { MAP_PRESETS } from './maps';
import {
  atmospheresEqual,
  cloneAtmosphere,
  resolveAtmosphere,
} from './atmosphereVariants';

describe('resolveAtmosphere', () => {
  it('keeps day + clear pixel-identical to the map atmosphere', () => {
    for (const preset of Object.values(MAP_PRESETS)) {
      const resolved = resolveAtmosphere(preset.atmosphere, 'day', 'clear').atmosphere;
      expect(atmospheresEqual(resolved, preset.atmosphere)).toBe(true);
      // Defensive copy: mutating the result must not change the preset.
      resolved.sky = '#000000';
      expect(preset.atmosphere.sky).not.toBe('#000000');
    }
  });

  it('darkens night relative to day', () => {
    const base = MAP_PRESETS.highlands.atmosphere;
    const day = resolveAtmosphere(base, 'day', 'clear').atmosphere;
    const night = resolveAtmosphere(base, 'night', 'clear').atmosphere;
    expect(night.sunStrength).toBeLessThan(day.sunStrength);
    expect(night.exposure).toBeLessThan(day.exposure);
    expect(resolveAtmosphere(base, 'night', 'clear').extras.accentEmissiveMul).toBeGreaterThan(1);
  });

  it('applies rain haze and snow white-out on top of time of day', () => {
    const base = MAP_PRESETS.highlands.atmosphere;
    const clearNight = resolveAtmosphere(base, 'night', 'clear').atmosphere;
    const rainyNight = resolveAtmosphere(base, 'night', 'rain').atmosphere;
    const snowyDay = resolveAtmosphere(base, 'day', 'snow').atmosphere;
    expect(rainyNight.fogNear).toBeLessThan(clearNight.fogNear);
    expect(rainyNight.sunStrength).toBeLessThan(clearNight.sunStrength);
    expect(snowyDay.fogFar).toBeLessThan(base.fogFar);
  });

  it('is order-stable for the same inputs', () => {
    const base = cloneAtmosphere(MAP_PRESETS['crater-oasis'].atmosphere);
    const a = resolveAtmosphere(base, 'sunset', 'rain').atmosphere;
    const b = resolveAtmosphere(base, 'sunset', 'rain').atmosphere;
    expect(atmospheresEqual(a, b)).toBe(true);
  });
});
