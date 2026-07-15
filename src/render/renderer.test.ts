import { describe, expect, it } from 'vitest';
import { degradedVisualQualityTier, suggestedInitialVisualQuality, visualPixelRatioForTier } from './renderer';

describe('adaptive render quality', () => {
  it('starts multiplayer conservatively on limited hardware', () => {
    expect(suggestedInitialVisualQuality(true, 4, 8)).toBe(1);
    expect(suggestedInitialVisualQuality(true, 8, 4)).toBe(1);
    expect(suggestedInitialVisualQuality(true, 8, 8)).toBe(0);
    expect(suggestedInitialVisualQuality(false, 2, 2)).toBe(0);
  });

  it('drops directly to performance mode during severe frame stalls', () => {
    expect(degradedVisualQualityTier(0, 0.12)).toBe(2);
    expect(degradedVisualQualityTier(1, 0.08)).toBe(2);
  });

  it('steps down once for sustained moderate pressure', () => {
    expect(degradedVisualQualityTier(0, 0.036)).toBe(1);
    expect(degradedVisualQualityTier(1, 0.036)).toBe(2);
    expect(degradedVisualQualityTier(0, 0.02)).toBe(0);
  });

  it('keeps low-end multiplayer readable while respecting the device cap', () => {
    expect(visualPixelRatioForTier(1, 0.9, true)).toBe(0.75);
    expect(visualPixelRatioForTier(2, 0.9, true)).toBe(0.68);
    expect(visualPixelRatioForTier(2, 0.6, true)).toBe(0.6);
  });
});
