import { describe, expect, it } from 'vitest';
import { missileSoundProfile, positionalGain } from './positionalMix';

describe('quiet missile mix', () => {
  it.each(['launch', 'impact', 'flight', 'flyby'] as const)('holds the %s level constant throughout the nearby area', (phase) => {
    const profile = missileSoundProfile({ gain: 0.5, near: 30, far: 900 }, phase);
    expect(profile.gain).toBeLessThanOrEqual(0.045);
    expect(positionalGain(0, profile)).toBe(profile.gain);
    expect(positionalGain(profile.near / 2, profile)).toBe(profile.gain);
    expect(positionalGain(profile.near, profile)).toBe(profile.gain);
    expect(positionalGain((profile.near + profile.far) / 2, profile)).toBeCloseTo(profile.gain / 2);
    expect(positionalGain(profile.far, profile)).toBe(0);
    expect(positionalGain(1000, profile)).toBe(0);
  });

  it('reduces already quiet samples without making them louder', () => {
    expect(missileSoundProfile({ gain: 0.07, near: 20, far: 300 }, 'launch').gain).toBeCloseTo(0.0175);
  });

  it('keeps strategic explosions local rather than audible across the map', () => {
    const profile = missileSoundProfile({ gain: 0.68, near: 65, far: 900 }, 'impact', true);
    expect(positionalGain(300, profile)).toBe(0);
    expect(profile.gain).toBe(0.045);
  });

  it('preserves the existing distance curve for other sounds', () => {
    const profile = { gain: 0.4, near: 20, far: 100 };
    expect(positionalGain(0, profile)).toBe(0.4);
    expect(positionalGain(60, profile)).toBeCloseTo(0.1);
    expect(positionalGain(100, profile)).toBe(0);
  });
});
