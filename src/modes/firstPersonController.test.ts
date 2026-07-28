import { Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../sim/components';
import {
  fortressOpticalFov,
  fortressTargetScanConeRatio,
  fortressTargetScanRingSize,
  keyboardAircraftClimb,
  MAX_DIRECT_CONTROL_SQUAD,
  resolveExitCameraPose,
  selectDirectControlSquad,
  type CameraPose,
} from './firstPersonController';

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

describe('direct-control squads', () => {
  it('caps very large selections and keeps the nearest wingmen around the chosen leader', () => {
    const candidates = Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      transform: { x: index * 6, z: 0, rot: 0 },
      mover: { speed: 12, radius: 2 },
      possessable: { socketHeight: 1.5 },
    })) as Entity[];

    const result = selectDirectControlSquad(candidates, 20);

    expect(result.leader).toBe(candidates[20]);
    expect(result.squad).toHaveLength(MAX_DIRECT_CONTROL_SQUAD);
    expect(result.squad).toContain(result.leader);
    expect(Math.max(...result.squad.map((unit) => Math.abs(unit.transform.x - result.leader!.transform.x)))).toBeLessThan(40);
  });

  it('ignores destroyed and non-possessable units', () => {
    const eligible = {
      id: 1,
      transform: { x: 0, z: 0, rot: 0 },
      mover: { speed: 12, radius: 2 },
      possessable: { socketHeight: 1.5 },
    } as Entity;
    const destroyed = {
      ...eligible,
      id: 2,
      destroyed: { remaining: 10 },
    } as Entity;
    const result = selectDirectControlSquad([destroyed, eligible], 0);

    expect(result).toEqual({ leader: eligible, squad: [eligible] });
  });
});

describe('fortress target scan', () => {
  it('expands both the visible sweep and assisted acquisition cone while held', () => {
    expect(fortressTargetScanRingSize(0)).toBe(96);
    expect(fortressTargetScanRingSize(0.5)).toBeGreaterThan(fortressTargetScanRingSize(0));
    expect(fortressTargetScanRingSize(1)).toBe(340);
    expect(fortressTargetScanConeRatio(0)).toBeCloseTo(0.045);
    expect(fortressTargetScanConeRatio(1)).toBeCloseTo(0.21);
  });

  it('clamps scan expansion safely outside the animation range', () => {
    expect(fortressTargetScanRingSize(-1)).toBe(96);
    expect(fortressTargetScanRingSize(2)).toBe(340);
    expect(fortressTargetScanConeRatio(-1)).toBeCloseTo(0.045);
    expect(fortressTargetScanConeRatio(2)).toBeCloseTo(0.21);
  });
});

describe('fortress optical zoom', () => {
  it('provides a wider overview and a strong long-range zoom', () => {
    expect(fortressOpticalFov(-1)).toBe(68);
    expect(fortressOpticalFov(0)).toBe(54);
    expect(fortressOpticalFov(1)).toBe(18);
  });

  it('clamps wheel zoom safely at both optical limits', () => {
    expect(fortressOpticalFov(-5)).toBe(68);
    expect(fortressOpticalFov(5)).toBe(18);
  });
});
