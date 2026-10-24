import { describe, expect, it } from 'vitest';
import { NetworkTickDriver, SIM_DT } from './loop';

describe('NetworkTickDriver', () => {
  it('rechecks lockstep readiness between simulation ticks instead of batching them', () => {
    let ready = true;
    const driver = new NetworkTickDriver(() => ready);

    expect(driver.frame(SIM_DT * 8).ticks).toBe(1);
    ready = false;
    expect(driver.frame(0).ticks).toBe(0);
    ready = true;
    expect(driver.frame(0).ticks).toBe(1);
  });

  it('does not rewind the visible unit when a network barrier starts waiting', () => {
    let ready = true;
    const driver = new NetworkTickDriver(() => ready);
    const moving = driver.frame(SIM_DT * 1.5);
    expect(moving.ticks).toBe(1);
    expect(moving.alpha).toBeCloseTo(0.5);
    ready = false;
    const waiting = driver.frame(SIM_DT * 0.25);
    expect(waiting.ticks).toBe(0);
    expect(waiting.alpha).toBeGreaterThan(moving.alpha);
    const held = driver.frame(SIM_DT * 10);
    expect(held.ticks).toBe(0);
    expect(held.alpha).toBe(0.999);
    expect(driver.frame(0).alpha).toBe(held.alpha);
    ready = true;
    expect(driver.frame(0).ticks).toBe(1);
  });
});
