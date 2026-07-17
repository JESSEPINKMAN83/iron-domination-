import { describe, expect, it } from 'vitest';
import { joystickDriveAxes, retainedJoystickDrive } from './gameControls';

describe('mobile analog joystick', () => {
  it('maps full travel to proportional forward, reverse, and steering input', () => {
    expect(joystickDriveAxes(0, -1)).toEqual({ throttle: 1, turn: -0 });
    expect(joystickDriveAxes(0, 1)).toEqual({ throttle: -1, turn: -0 });
    expect(joystickDriveAxes(-1, 0)).toEqual({ throttle: 1, turn: 1 });
    expect(joystickDriveAxes(1, 0)).toEqual({ throttle: 1, turn: -1 });
  });

  it('keeps full forward drive while steering diagonally', () => {
    const drive = joystickDriveAxes(0.8, -0.8);
    expect(drive.throttle).toBe(1);
    expect(drive.turn).toBeLessThan(-0.65);
  });

  it('uses a small center dead zone and scales smoothly outside it', () => {
    expect(joystickDriveAxes(0.05, -0.05)).toEqual({ throttle: 0, turn: 0 });
    const partial = joystickDriveAxes(0, -0.56);
    expect(partial.throttle).toBeGreaterThan(0.65);
    expect(partial.throttle).toBeLessThan(0.7);
    expect(partial.turn).toBe(-0);
  });

  it('uses full directional strength for any engaged joystick position while speed is held', () => {
    const shallow = joystickDriveAxes(0.16, -0.12, { fullStrength: true });
    expect(shallow.throttle).toBe(1);
    expect(shallow.turn).toBeLessThan(0);
    expect(joystickDriveAxes(0.04, -0.03, { fullStrength: true })).toEqual({ throttle: 0, turn: 0 });
  });

  it('does not brake when the joystick sweeps from right steering to left steering', () => {
    const right = joystickDriveAxes(0.7, 0, { fullStrength: true });
    const nearCenter = joystickDriveAxes(0.12, 0, { fullStrength: true });
    const left = joystickDriveAxes(-0.7, 0, { fullStrength: true });
    expect(right).toEqual({ throttle: 1, turn: -1 });
    expect(nearCenter).toEqual({ throttle: 1, turn: -1 });
    expect(left).toEqual({ throttle: 1, turn: 1 });
  });

  it('bridges a center crossing and retains full direction there only while speed is held', () => {
    const lastDrive = { throttle: 0.46, turn: -0.22 };
    const lastDirection = { throttle: 0.9, turn: -0.44 };
    expect(retainedJoystickDrive(lastDrive, lastDirection, false, false)).toEqual(lastDrive);
    expect(retainedJoystickDrive(lastDrive, lastDirection, false, true)).toEqual({ throttle: 0, turn: 0 });
    expect(retainedJoystickDrive(lastDrive, lastDirection, true, true)).toEqual(lastDirection);
    expect(retainedJoystickDrive(lastDrive, { throttle: 0, turn: 0 }, true, false)).toEqual({ throttle: 0, turn: 0 });
  });
});
