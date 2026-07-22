import { describe, expect, it } from 'vitest';
import {
  hitFlashOpacity,
  hitShakeProfile,
  impactForceFromEvent,
  lowHpVignetteOpacity,
  possessionHitGain,
  reticleFlashIntensity,
} from './vModeHitJuice';

describe('v-mode hit juice', () => {
  it('clamps impact force from event force or damage ratio', () => {
    expect(impactForceFromEvent({ force: 0.5, damage: 10, targetMaxHealth: 100 })).toBe(0.5);
    expect(impactForceFromEvent({ damage: 25, targetMaxHealth: 100 })).toBe(0.25);
    expect(impactForceFromEvent({ force: 2, damage: 1 })).toBe(1);
  });

  it('scales shake and flash with force', () => {
    const soft = hitShakeProfile(0.2);
    const hard = hitShakeProfile(0.9);
    expect(hard.strength).toBeGreaterThan(soft.strength);
    expect(hard.duration).toBeGreaterThan(soft.duration);
    expect(hitFlashOpacity(0.9)).toBeGreaterThan(hitFlashOpacity(0.2));
    expect(reticleFlashIntensity(0.9)).toBeGreaterThan(reticleFlashIntensity(0.2));
    expect(possessionHitGain(0.9)).toBeGreaterThan(possessionHitGain(0.2));
  });

  it('only shows low-HP vignette below 35% hull', () => {
    expect(lowHpVignetteOpacity(0.5)).toBe(0);
    expect(lowHpVignetteOpacity(0.35)).toBe(0);
    expect(lowHpVignetteOpacity(0.2)).toBeGreaterThan(0.3);
    expect(lowHpVignetteOpacity(0.05)).toBeGreaterThan(lowHpVignetteOpacity(0.2));
  });
});
