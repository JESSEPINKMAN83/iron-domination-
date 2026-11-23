import { describe, expect, it } from 'vitest';
import { AccumulatorTickDriver, NetworkTickDriver, SIM_DT } from './loop';

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


describe('single-player game speed', () => {
  it('advances two or three times as many fixed ticks and supports changing speed mid-match', () => {
    let speed = 1;
    const driver = new AccumulatorTickDriver(8, () => speed);
    expect(driver.frame(SIM_DT).ticks).toBe(1);
    speed = 2;
    expect(driver.frame(SIM_DT).ticks).toBe(2);
    speed = 3;
    expect(driver.frame(SIM_DT).ticks).toBe(3);
    speed = 1;
    expect(driver.frame(SIM_DT).ticks).toBe(1);
  });

  it('keeps catch-up bounded during a stall at triple speed', () => {
    const driver = new AccumulatorTickDriver(8, () => 3);
    const frame = driver.frame(0.25);
    expect(frame.ticks).toBe(8);
    expect(frame.alpha).toBeLessThan(1);
    expect(driver.frame(0).ticks).toBe(0);
  });
});
