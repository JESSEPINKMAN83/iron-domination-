import { describe, expect, it } from 'vitest';
import { degradedVisualQualityTier, suggestedInitialVisualQuality } from './renderer';

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
});
