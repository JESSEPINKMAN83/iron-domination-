import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../sim/components';
import {
  directControlFollowerAnchor,
  fortressOpticalFov,
  fortressTargetScanConeRatio,
  fortressTargetScanRingSize,
  keyboardAircraftClimb,
  keyboardLookYaw,
  FirstPersonController,
  MAX_DIRECT_CONTROL_SQUAD,
  resolveExitCameraPose,
  selectDirectControlSquad,
  type CameraPose,
} from './firstPersonController';

describe('V-mode keyboard look', () => {
  it('turns Q left and E right without mouse input at the same rate across frame rates', () => {
    const left = (code: string) => code === 'KeyQ';
    const right = (code: string) => code === 'KeyE';
    expect(keyboardLookYaw(left, 1 / 60) * 60).toBeCloseTo(Math.PI / 2);
    expect(keyboardLookYaw(right, 1 / 30) * 30).toBeCloseTo(-Math.PI / 2);
    expect(keyboardLookYaw(code => left(code) || right(code), 1 / 60)).toBe(0);
    expect(keyboardLookYaw(() => false, 1 / 60)).toBe(0);
  });

  it('does not jump the heading after a stalled frame', () => {
    expect(keyboardLookYaw(code => code === 'KeyQ', 2)).toBeCloseTo(Math.PI / 40);
  });
});

describe('aircraft chase camera stability', () => {
  function harness() {
    // Exercise the real camera calculation without constructing unrelated DOM HUDs.
    const controller = Object.assign(Object.create(FirstPersonController.prototype), {
      tmpForward:new Vector3(), tmpHorizontal:new Vector3(), tmpVelocityDir:new Vector3(),
      tmpFlightTarget:new Vector3(), tmpFlightPosition:new Vector3(), tmpAimTarget:new Vector3(),
      tmpCameraTarget:new Vector3(), poseCamera:new PerspectiveCamera(),
      hasFlightCameraMotion:false, smoothFlightSpeed:0, smoothFlightVelocityYaw:0,
      orbitYaw:0, orbitPitch:0, renderChaseZoom:0,
      interpolatedCenter:(entity:Entity, alpha:number)=>new Vector3().lerpVectors(
        new Vector3(entity.previousTransform.x,20,entity.previousTransform.z),
        new Vector3(entity.transform.x,20,entity.transform.z), alpha),
    }) as { flightPoseFor:(e:Entity,yaw:number,pitch:number,fov:number,alpha:number,dt:number)=>CameraPose };
    const entity = {
      previousTransform:{x:0,z:0,rot:0},transform:{x:0,z:2,rot:0},velocity:{x:0,z:46},
      flight:{model:'gunship',previousRollAttitude:0,rollAttitude:0},
    } as Entity;
    return {controller,entity};
  }

  it('tracks the same interpolated position as the visible aircraft without a second delayed anchor', () => {
    const {controller,entity}=harness();
    const first=controller.flightPoseFor(entity,0,0,64,0,1/60);
    const half=controller.flightPoseFor(entity,0,0,64,0.5,1/60);
    const end=controller.flightPoseFor(entity,0,0,64,1,1/60);
    expect(half.position.z-first.position.z).toBeCloseTo(1);
    expect(end.position.z-first.position.z).toBeCloseTo(2);
    expect(first.quaternion.angleTo(end.quaternion)).toBeCloseTo(0);
  });

  it('eases tick-sized speed and velocity changes instead of snapping the chase view', () => {
    const {controller,entity}=harness();
    entity.velocity!.z=0;
    const hover=controller.flightPoseFor(entity,0,0,64,0,1/60);
    entity.velocity!.x=46;
    const next=controller.flightPoseFor(entity,0,0,64,0,1/60);
    expect(next.fov).toBeGreaterThan(hover.fov);
    expect(next.fov-hover.fov).toBeLessThan(1);
    expect(hover.quaternion.angleTo(next.quaternion)).toBeLessThan(0.12);
  });
});

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

  it('keeps wingmen behind the leader instead of ordering them onto its position', () => {
    const leader = {
      id: 1,
      transform: { x: 20, z: 30, rot: 0 },
      mover: { speed: 12, radius: 3 },
    } as Entity;
    const follower = {
      id: 2,
      transform: { x: 0, z: 0, rot: 0 },
      mover: { speed: 12, radius: 3 },
    } as Entity;

    expect(directControlFollowerAnchor(leader, [follower])).toEqual({ x: 20, z: 16 });
    leader.transform.rot = Math.PI / 2;
    const turned = directControlFollowerAnchor(leader, [follower]);
    expect(turned.x).toBeCloseTo(6);
    expect(turned.z).toBeCloseTo(30);
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
