import { describe, expect, it, vi, afterEach } from 'vitest';
import { limitedDesktopHardware, performanceGraphics, performanceRenderScale, readGraphicsPreference } from './graphicsPreference';
afterEach(() => vi.unstubAllGlobals());
describe('local laptop graphics', () => {
  it('leaves strong desktops and unknown hardware on the existing renderer', () => {
    expect(performanceGraphics('auto', false, 8, 8)).toBe(false);
    expect(performanceGraphics('auto', false)).toBe(false);
    expect(limitedDesktopHardware(0, -1)).toBe(false);
  });
  it('starts limited desktops lean without downgrading phones on CPU hints alone', () => {
    expect(performanceGraphics('auto', false, 4, 8)).toBe(true);
    expect(performanceGraphics('auto', false, 8, 4)).toBe(true);
    expect(performanceGraphics('auto', true, 4, 4)).toBe(false);
    expect(performanceGraphics('performance', true, 8, 8)).toBe(true);
  });
  it('caps GPU fill rate on a large external monitor while keeping UI separate', () => {
    const scale = performanceRenderScale(3840, 2160, 1.25);
    expect(3840 * 2160 * scale * scale).toBeCloseTo(900_000);
    expect(performanceRenderScale(1280, 720, 1.25)).toBe(0.75);
    expect(performanceRenderScale(1280, 720, 0.5)).toBe(0.5);
  });
  it('handles blocked storage and ignores unrelated/invalid saved values', () => {
    vi.stubGlobal('localStorage', {getItem: () => { throw new Error('blocked'); }});
    expect(readGraphicsPreference()).toBe('auto');
    vi.stubGlobal('localStorage', {getItem: () => 'high'});
    expect(readGraphicsPreference()).toBe('auto');
    vi.stubGlobal('localStorage', {getItem: () => 'performance'});
    expect(readGraphicsPreference()).toBe('performance');
  });
});
