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
});
