import { describe, expect, it } from 'vitest';
import {
  degradedVisualQualityTierAfterPressure,
  isExplicitQualityTier,
  mobileSafePixelRatio,
  performanceExposure,
  qualityTierFromQuery,
  recoveredVisualQualityTier,
  resolvedRenderViewportSize,
  shouldIgnoreAdaptiveQualityFrame,
  suggestedInitialVisualQuality,
  visualPixelRatioForTier,
} from './renderer';

describe('adaptive render quality', () => {
  it('starts multiplayer conservatively on limited hardware', () => {
    expect(suggestedInitialVisualQuality(true, 4, 8)).toBe(1);
    expect(suggestedInitialVisualQuality(true, 8, 4)).toBe(1);
    expect(suggestedInitialVisualQuality(true, 8, 8)).toBe(0);
    expect(suggestedInitialVisualQuality(false, 2, 2)).toBe(0);
  });

  it('does not downgrade after an isolated severe frame window', () => {
    expect(degradedVisualQualityTierAfterPressure(0, 0.12, 1)).toBe(0);
    expect(degradedVisualQualityTierAfterPressure(1, 0.08, 1)).toBe(1);
  });

  it('moves only one tier after sustained severe pressure', () => {
    expect(degradedVisualQualityTierAfterPressure(0, 0.08, 1)).toBe(0);
    expect(degradedVisualQualityTierAfterPressure(0, 0.08, 2)).toBe(1);
    expect(degradedVisualQualityTierAfterPressure(1, 0.08, 2)).toBe(1);
    expect(degradedVisualQualityTierAfterPressure(1, 0.08, 3)).toBe(2);
  });

  it('requires several consecutive windows for moderate pressure', () => {
    expect(degradedVisualQualityTierAfterPressure(0, 0.045, 3)).toBe(0);
    expect(degradedVisualQualityTierAfterPressure(0, 0.045, 4)).toBe(1);
    expect(degradedVisualQualityTierAfterPressure(1, 0.045, 4)).toBe(1);
    expect(degradedVisualQualityTierAfterPressure(1, 0.045, 5)).toBe(2);
    expect(degradedVisualQualityTierAfterPressure(0, 0.03, 20)).toBe(0);
  });

  it('ignores tab-switch frames and recovers promptly after performance returns', () => {
    expect(shouldIgnoreAdaptiveQualityFrame(0.25, false)).toBe(true);
    expect(shouldIgnoreAdaptiveQualityFrame(1 / 60, true)).toBe(true);
    expect(shouldIgnoreAdaptiveQualityFrame(1 / 60, false)).toBe(false);
    expect(recoveredVisualQualityTier(2, 1 / 60, 3)).toBe(2);
    expect(recoveredVisualQualityTier(2, 1 / 60, 4)).toBe(1);
  });

  it('locks explicit visual test modes and preserves direct-render exposure', () => {
    expect(qualityTierFromQuery('performance')).toBe(2);
    expect(qualityTierFromQuery('balanced')).toBe(1);
    expect(qualityTierFromQuery('full')).toBe(0);
    expect(qualityTierFromQuery(null)).toBeUndefined();
    expect(isExplicitQualityTier('low')).toBe(true);
    expect(isExplicitQualityTier(null)).toBe(false);
    expect(performanceExposure(1.1, false)).toBeCloseTo(1.1);
    expect(performanceExposure(1.1, true)).toBeCloseTo(1.177);
  });

  it('keeps low-end multiplayer readable while respecting the device cap', () => {
    expect(visualPixelRatioForTier(1, 0.9, true)).toBe(0.75);
    expect(visualPixelRatioForTier(2, 0.9, true)).toBe(0.68);
    expect(visualPixelRatioForTier(2, 0.6, true)).toBe(0.6);
  });

  it('starts strong phones at desktop sharpness and degrades only under measured pressure', () => {
    expect(mobileSafePixelRatio(0, 3)).toBe(1.25);
    expect(mobileSafePixelRatio(1, 3)).toBe(1);
    expect(mobileSafePixelRatio(2, 3)).toBe(0.85);
    expect(mobileSafePixelRatio(0, 0.7)).toBe(0.7);
  });

  it('uses the live game container dimensions and falls back safely while it is hidden', () => {
    expect(resolvedRenderViewportSize(844.4, 390.4, 600, 300)).toEqual({ width: 844, height: 390 });
    expect(resolvedRenderViewportSize(0, 0, 932.2, 430.2)).toEqual({ width: 932, height: 430 });
    expect(resolvedRenderViewportSize(0, 0, 0, 0)).toEqual({ width: 1, height: 1 });
  });
});
