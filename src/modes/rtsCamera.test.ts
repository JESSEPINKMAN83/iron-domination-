import { describe, expect, it } from 'vitest';
import { getEdgePanInput } from './rtsCamera';

describe('RTS camera screen-edge pan', () => {
  it('does not pan while the cursor is outside the edge zones', () => {
    expect(getEdgePanInput(640, 360, 1280, 720)).toEqual({ x: 0, forward: 0 });
    expect(getEdgePanInput(100, 100, 1280, 720)).toEqual({ x: 0, forward: 0 });
  });

  it('uses the expanded mouse-only navigation zone', () => {
    expect(getEdgePanInput(80, 360, 1280, 720).x).toBeLessThan(0);
    expect(getEdgePanInput(1200, 360, 1280, 720).x).toBeGreaterThan(0);
  });

  it('moves in the direction of every screen edge', () => {
    expect(getEdgePanInput(0, 360, 1280, 720)).toEqual({ x: -1, forward: 0 });
    expect(getEdgePanInput(1280, 360, 1280, 720)).toEqual({ x: 1, forward: 0 });
    expect(getEdgePanInput(640, 0, 1280, 720)).toEqual({ x: 0, forward: 1 });
    expect(getEdgePanInput(640, 720, 1280, 720)).toEqual({ x: 0, forward: -1 });
  });

  it('combines edges into diagonal corner movement', () => {
    expect(getEdgePanInput(0, 0, 1280, 720)).toEqual({ x: -1, forward: 1 });
    expect(getEdgePanInput(0, 720, 1280, 720)).toEqual({ x: -1, forward: -1 });
  });

  it('accelerates continuously as the cursor approaches the outer edge', () => {
    const nearInnerEdge = Math.abs(getEdgePanInput(90, 360, 1280, 720).x);
    const halfway = Math.abs(getEdgePanInput(46.8, 360, 1280, 720).x);
    const outerEdge = Math.abs(getEdgePanInput(0, 360, 1280, 720).x);

    expect(nearInnerEdge).toBeGreaterThan(0);
    expect(halfway).toBeGreaterThan(nearInnerEdge);
    expect(outerEdge).toBeGreaterThan(halfway);
  });
});
