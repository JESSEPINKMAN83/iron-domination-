import { describe, expect, it } from 'vitest';
import {
  isModifiedCameraPointer,
  isStopCommandKey,
  shouldUseFastMoveDoubleClick,
  shouldDeselectWithTwoFingerTap,
  shouldGroundAttackFromPointer,
  shouldUseTouchCommand,
} from './rtsController';

describe('mobile RTS gesture intent', () => {
  it('lassos with no selection or from a friendly unit, and commands ground or enemies after selection', () => {
    expect(shouldUseTouchCommand(0, undefined, 1)).toBe(false);
    expect(shouldUseTouchCommand(4, 1, 1)).toBe(false);
    expect(shouldUseTouchCommand(4, undefined, 1)).toBe(true);
    expect(shouldUseTouchCommand(4, 2, 1)).toBe(true);
  });

  it('only clears a selection for a short, stationary two-finger tap', () => {
    expect(shouldDeselectWithTwoFingerTap(3, 5, 180)).toBe(true);
    expect(shouldDeselectWithTwoFingerTap(0, 5, 180)).toBe(false);
    expect(shouldDeselectWithTwoFingerTap(3, 13, 180)).toBe(false);
    expect(shouldDeselectWithTwoFingerTap(3, 5, 301)).toBe(false);
  });

  it('uses Command as the desktop attack-ground modifier', () => {
    expect(shouldGroundAttackFromPointer(false, false)).toBe(false);
    expect(shouldGroundAttackFromPointer(true, false)).toBe(true);
    expect(shouldGroundAttackFromPointer(false, true)).toBe(true);
  });
});

describe('desktop RTS camera and command separation', () => {
  it('recognizes only a quick nearby desktop double-click as a rapid move', () => {
    expect(shouldUseFastMoveDoubleClick(210, 8, false, 'mouse')).toBe(true);
    expect(shouldUseFastMoveDoubleClick(340, 8, false, 'mouse')).toBe(false);
    expect(shouldUseFastMoveDoubleClick(210, 24, false, 'mouse')).toBe(false);
    expect(shouldUseFastMoveDoubleClick(210, 8, true, 'mouse')).toBe(false);
    expect(shouldUseFastMoveDoubleClick(210, 8, false, 'touch')).toBe(false);
  });

  it('keeps WASD camera movement separate from the unit stop command', () => {
    expect(isStopCommandKey('KeyS')).toBe(false);
    expect(isStopCommandKey('KeyW')).toBe(false);
    expect(isStopCommandKey('KeyX')).toBe(true);
  });

  it('reserves both Command-drag and Control-drag for camera interaction', () => {
    expect(isModifiedCameraPointer(0, true, false)).toBe(true);
    expect(isModifiedCameraPointer(0, false, true)).toBe(true);
    expect(isModifiedCameraPointer(0, false, false)).toBe(false);
    expect(isModifiedCameraPointer(2, true, false)).toBe(false);
  });
});
