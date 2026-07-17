import { describe, expect, it } from 'vitest';
import { resolveMobileViewport, shouldUseMobileControls } from './platform';

describe('mobile capability detection', () => {
  it('requires both touch input and a coarse primary pointer', () => {
    expect(shouldUseMobileControls({ maxTouchPoints: 5, coarsePointer: true })).toBe(true);
    expect(shouldUseMobileControls({ maxTouchPoints: 0, coarsePointer: true })).toBe(false);
    expect(shouldUseMobileControls({ maxTouchPoints: 5, coarsePointer: false })).toBe(false);
  });
});

describe('mobile app viewport', () => {
  it('tracks the live visual viewport so browser chrome changes do not leave a bottom gap', () => {
    expect(resolveMobileViewport({
      layoutWidth: 844,
      layoutHeight: 340,
      visualWidth: 844,
      visualHeight: 390,
      visualOffsetLeft: 0,
      visualOffsetTop: 12,
      screenWidth: 844,
      screenHeight: 390,
      landscape: true,
    })).toEqual({ left: 0, top: 12, width: 844, height: 390 });
  });

  it('bleeds across Safari safe-area letterboxing in landscape', () => {
    expect(resolveMobileViewport({
      layoutWidth: 734,
      layoutHeight: 340,
      visualWidth: 734,
      visualHeight: 340,
      visualOffsetLeft: 0,
      visualOffsetTop: 0,
      screenWidth: 844,
      screenHeight: 390,
      landscape: true,
    })).toEqual({ left: -55, top: 0, width: 844, height: 340 });
  });

  it('does not expand to an unrelated desktop screen during mobile preview', () => {
    expect(resolveMobileViewport({
      layoutWidth: 900,
      layoutHeight: 420,
      visualWidth: 900,
      visualHeight: 420,
      screenWidth: 1728,
      screenHeight: 1117,
      landscape: true,
    })).toEqual({ left: 0, top: 0, width: 900, height: 420 });
  });
});
