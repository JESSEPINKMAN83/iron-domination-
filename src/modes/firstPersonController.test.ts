import { Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { keyboardAircraftClimb, resolveExitCameraPose, type CameraPose } from './firstPersonController';

function pose(x: number, y: number, z: number, fov: number): CameraPose {
  return {
    position: new Vector3(x, y, z),
    quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7),
    fov,
  };
}

describe('first-person camera transitions', () => {
  it('uses the prepared nearby strategy pose centered on the unit exit location', () => {
    const prepared = pose(120, 82, -85, 50);
    const fallback = vi.fn(() => pose(10, 40, 15, 50));

    const result = resolveExitCameraPose(prepared, fallback);

    expect(fallback).not.toHaveBeenCalled();
    expect(result.position.toArray()).toEqual(prepared.position.toArray());
    expect(result.quaternion.toArray()).toEqual(prepared.quaternion.toArray());
    expect(result.fov).toBe(50);
    expect(result.position).not.toBe(prepared.position);
    expect(result.quaternion).not.toBe(prepared.quaternion);
  });

  it('keeps the nearby RTS pose as a safe fallback when no strategy pose exists', () => {
    const nearby = pose(15, 42, 18, 50);
    const result = resolveExitCameraPose(undefined, () => nearby);

    expect(result.position.toArray()).toEqual(nearby.position.toArray());
    expect(result.quaternion.toArray()).toEqual(nearby.quaternion.toArray());
  });
});

describe('aircraft keyboard altitude', () => {
  it('uses Space to climb and C to descend', () => {
    expect(keyboardAircraftClimb((code) => code === 'Space')).toBe(1);
    expect(keyboardAircraftClimb((code) => code === 'KeyC')).toBe(-1);
  });

  it('does not descend when Control is pressed', () => {
    expect(keyboardAircraftClimb((code) => code === 'ControlLeft' || code === 'ControlRight')).toBe(0);
  });
});
