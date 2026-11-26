import { describe, expect, it } from 'vitest';
import { selectionPickRadius, selectionRingScale } from './selectionPresentation';

describe('selection at different zoom levels', () => {
  it('tracks the visible hull close up and bounds assistance at extreme zoom', () => {
    expect(selectionPickRadius(5, 40, 2, 800, false)).toBe(84);
    expect(selectionPickRadius(5, 200, 2, 800, false)).toBe(25);
    expect(selectionPickRadius(5, 1000, 2, 800, false)).toBe(18);
    expect(selectionPickRadius(1, 1000, 2, 800, true)).toBe(14);
  });
  it('keeps distant rings legible without growing nearby rings or unbounded overlays', () => {
    expect(selectionRingScale(3, 40, 2, 800)).toBe(1);
    expect(selectionRingScale(3, 600, 2, 800)).toBe(2);
    expect(selectionRingScale(3, 100000, 2, 800)).toBe(3);
  });
});
