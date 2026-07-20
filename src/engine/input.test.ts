import { describe, expect, it } from 'vitest';
import { Input, isTextEntryTarget } from './input';

describe('keyboard event targets', () => {
  it('recognizes fields that must receive normal text editing keys', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

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
