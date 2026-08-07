import { describe, expect, it } from 'vitest';
import { macroTintFactors } from './textures';

describe('ground macro tint', () => {
  it('stays subtle enough to preserve unit and terrain readability', () => {
    for (const style of ['temperate', 'desert', 'snow'] as const) {
      for (const broad of [0, 0.5, 1]) {
        const factors = macroTintFactors(style, broad, 0.7, 0.4);
        factors.forEach((factor) => {
          expect(factor).toBeGreaterThanOrEqual(0.68);
          expect(factor).toBeLessThanOrEqual(1.32);
        });
      }
    }
  });

  it('gives the three biomes different colour responses', () => {
    const temperate = macroTintFactors('temperate', 0.8, 0.3, 0.9);
    const desert = macroTintFactors('desert', 0.8, 0.3, 0.9);
    const snow = macroTintFactors('snow', 0.8, 0.3, 0.9);
    expect(desert).not.toEqual(temperate);
    expect(snow).not.toEqual(temperate);
  });
});
