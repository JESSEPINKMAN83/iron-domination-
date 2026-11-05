import { describe, expect, it } from 'vitest';
import { quickRoutePoints } from './quickTactic';
import { MAX_TACTIC_WAYPOINTS } from '../sim/tactics';

describe('quick battlefield routes', () => {
  it('preserves a short route without aliasing the draft', () => {
    const draft = [{ x: 1, z: 2 }, { x: 3, z: 4 }];
    const route = quickRoutePoints(draft);
    expect(route).toEqual(draft);
    expect(route[0]).not.toBe(draft[0]);
  });
  it('keeps both endpoints and samples the whole stroke within the command budget', () => {
    const draft = Array.from({ length: 1000 }, (_, x) => ({ x, z: Math.sin(x) }));
    const route = quickRoutePoints(draft);
    expect(route).toHaveLength(MAX_TACTIC_WAYPOINTS);
    expect(route[0]).toEqual(draft[0]);
    expect(route.at(-1)).toEqual(draft.at(-1));
    expect(route.every((point, i) => !i || point.x > route[i - 1].x)).toBe(true);
  });
});
