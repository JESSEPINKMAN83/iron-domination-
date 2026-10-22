import { describe, expect, it, vi } from 'vitest';
import {
  RtsController,
  isModifiedCameraPointer,
  isStopCommandKey,
  shouldUseFastMoveDoubleClick,
  shouldDeselectWithTwoFingerTap,
  shouldGroundAttackFromPointer,
  shouldUseTouchCommand,
} from './rtsController';
import type { Entity } from '../sim/components';

describe('objective and entity click selection', () => {
  function controller(hit?: Entity) {
    const inspect = vi.fn(() => true);
    const select = vi.fn();
    const instance = Object.create(RtsController.prototype) as {
      entityAt: ReturnType<typeof vi.fn>;
      updateSelection: typeof select;
      orderFeedback: { inspectObjectiveAtScreen: typeof inspect };
      lastClick: { time: number; entity?: Entity };
      selectClick(event: PointerEvent): void;
    };
    instance.entityAt = vi.fn(() => hit);
    instance.updateSelection = select;
    instance.orderFeedback = { inspectObjectiveAtScreen: inspect };
    instance.lastClick = { time: -Infinity };
    return { instance, inspect, select };
  }

  it('selects a picked unit or building instead of inspecting the objective behind it', () => {
    const entity = { id: 1, transform: { x: 0, z: 0, rot: 0 } } as Entity;
    const { instance, inspect, select } = controller(entity);
    instance.selectClick({ clientX: 100, clientY: 150, shiftKey: false } as PointerEvent);
    expect(select).toHaveBeenCalledWith([entity], false);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('inspects a standalone objective without clearing the existing selection', () => {
    const { instance, inspect, select } = controller();
    instance.selectClick({ clientX: 100, clientY: 150, shiftKey: false } as PointerEvent);
    expect(inspect).toHaveBeenCalledWith(100, 150);
    expect(select).not.toHaveBeenCalled();
  });

  it('keeps shift selection additive instead of opening objective information', () => {
    const { instance, inspect, select } = controller();
    instance.selectClick({ clientX: 100, clientY: 150, shiftKey: true } as PointerEvent);
    expect(inspect).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});

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
