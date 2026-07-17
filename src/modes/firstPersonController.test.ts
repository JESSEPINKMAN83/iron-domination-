import { Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { resolveExitCameraPose, type CameraPose } from './firstPersonController';

function pose(x: number, y: number, z: number, fov: number): CameraPose {
  return {
    position: new Vector3(x, y, z),
    quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7),
    fov,
  };
}

describe('first-person camera transitions', () => {
  it('returns to the exact strategy camera captured before entering control mode', () => {
    const saved = pose(120, 210, -85, 50);
    const fallback = vi.fn(() => pose(10, 40, 15, 50));

    const result = resolveExitCameraPose(saved, fallback);

    expect(fallback).not.toHaveBeenCalled();
    expect(result.position.toArray()).toEqual(saved.position.toArray());
    expect(result.quaternion.toArray()).toEqual(saved.quaternion.toArray());
    expect(result.fov).toBe(50);
    expect(result.position).not.toBe(saved.position);
    expect(result.quaternion).not.toBe(saved.quaternion);
  });

  it('keeps the nearby RTS pose as a safe fallback when no strategy pose exists', () => {
    const nearby = pose(15, 42, 18, 50);
    const result = resolveExitCameraPose(undefined, () => nearby);

    expect(result.position.toArray()).toEqual(nearby.position.toArray());
    expect(result.quaternion.toArray()).toEqual(nearby.quaternion.toArray());
  });
});
