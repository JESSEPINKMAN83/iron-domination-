import { describe, expect, it } from 'vitest';
import { shouldUseMobileControls } from './platform';

describe('mobile capability detection', () => {
  it('requires both touch input and a coarse primary pointer', () => {
    expect(shouldUseMobileControls({ maxTouchPoints: 5, coarsePointer: true })).toBe(true);
    expect(shouldUseMobileControls({ maxTouchPoints: 0, coarsePointer: true })).toBe(false);
    expect(shouldUseMobileControls({ maxTouchPoints: 5, coarsePointer: false })).toBe(false);
  });
});
