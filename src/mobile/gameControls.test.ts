import { describe, expect, it } from 'vitest';
import { joystickDriveAxes } from './gameControls';

describe('mobile analog joystick', () => {
  it('maps full travel to proportional forward, reverse, and steering input', () => {
    expect(joystickDriveAxes(0, -1)).toEqual({ throttle: 1, turn: -0 });
    expect(joystickDriveAxes(0, 1)).toEqual({ throttle: -1, turn: -0 });
    expect(joystickDriveAxes(-1, 0)).toEqual({ throttle: -0, turn: 1 });
    expect(joystickDriveAxes(1, 0)).toEqual({ throttle: -0, turn: -1 });
  });

  it('supports diagonal movement while keeping the output inside the unit circle', () => {
    const drive = joystickDriveAxes(0.8, -0.8);
    expect(drive.throttle).toBeGreaterThan(0.65);
    expect(drive.turn).toBeLessThan(-0.65);
    expect(Math.hypot(drive.throttle, drive.turn)).toBeCloseTo(1, 6);
  });

  it('uses a small center dead zone and scales smoothly outside it', () => {
    expect(joystickDriveAxes(0.05, -0.05)).toEqual({ throttle: 0, turn: 0 });
    const partial = joystickDriveAxes(0, -0.56);
    expect(partial.throttle).toBeCloseTo(0.5, 6);
    expect(partial.turn).toBe(-0);
  });
});
