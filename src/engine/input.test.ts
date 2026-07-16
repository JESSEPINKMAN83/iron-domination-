import { describe, expect, it } from 'vitest';
import { Input } from './input';

describe('mobile input state', () => {
  it('clamps virtual drive axes and resets transient controls', () => {
    const input = new Input(true);
    input.setMobileDrive({ throttle: 3, turn: -4, climb: Number.NaN, boost: true });

    expect(input.getMobileDrive()).toEqual({ throttle: 1, turn: -1, climb: 0, boost: true });

    input.addLookDelta(12, -9);
    input.addWheelDelta(20);
    input.resetTransientInputs();

    expect(input.getMobileDrive()).toEqual({ throttle: 0, turn: 0, climb: 0, boost: false });
    expect(input.consumeMouseDelta()).toEqual({ dx: 0, dy: 0 });
    expect(input.consumeWheel()).toBe(0);
  });
});
