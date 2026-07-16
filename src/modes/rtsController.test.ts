import { describe, expect, it } from 'vitest';
import { shouldUseTouchCommand } from './rtsController';

describe('mobile RTS gesture intent', () => {
  it('lassos with no selection or from a friendly unit, and commands ground or enemies after selection', () => {
    expect(shouldUseTouchCommand(0, undefined, 1)).toBe(false);
    expect(shouldUseTouchCommand(4, 1, 1)).toBe(false);
    expect(shouldUseTouchCommand(4, undefined, 1)).toBe(true);
    expect(shouldUseTouchCommand(4, 2, 1)).toBe(true);
  });
});
