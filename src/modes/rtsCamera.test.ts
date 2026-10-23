import { PerspectiveCamera } from 'three';
import { mapConfig } from '../content/maps';
import type { Input } from '../engine/input';
import { generateHeightfield } from '../sim/heightfield';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { RtsCameraRig, getEdgePanInput, openingViewDirection, strategyCameraYawFromAim } from './rtsCamera';

describe('RTS camera direct-control return heading', () => {
  it('places the strategy camera behind the unit aim direction', () => {
    for (const aimYaw of [0, Math.PI / 3, Math.PI / 2, -Math.PI * 0.72]) {
      const cameraYaw = strategyCameraYawFromAim(aimYaw);
      expect(Math.sin(cameraYaw)).toBeCloseTo(-Math.sin(aimYaw), 10);
      expect(Math.cos(cameraYaw)).toBeCloseTo(-Math.cos(aimYaw), 10);
    }
  });
});

describe('RTS opening camera', () => {
  afterEach(()=>vi.unstubAllGlobals());
  it('uses a lower shared opening view and faces the enemy from either spawn side', () => {
    vi.stubGlobal('window',{localStorage:{getItem:()=>null}});
    const hf=generateHeightfield({...mapConfig('highlands','small',150,30,'classic'),seed:41});
    const input={onKeyDown:()=>{}} as unknown as Input;
    for(const sign of [-1,1]){
      const rig=new RtsCameraRig(new PerspectiveCamera(),input,hf);
      rig.jumpToOpeningView(sign*100,sign*100,{x:-sign*100,z:-sign*100},sign===1?2:1);
      expect(rig.distance).toBe(240);
      expect(rig.pitchDegrees).toBeCloseTo(22);
      expect(-Math.sin(rig.yawRadians)).toBeCloseTo(-sign*Math.SQRT1_2);
      expect(-Math.cos(rig.yawRadians)).toBeCloseTo(-sign*Math.SQRT1_2);
    }
  });
  it('faces from the player base toward the actual nearest threat', () => {
    const direction = openingViewDirection(20, -10, { x: -40, z: 70 }, 1);
    expect(direction.x).toBeCloseTo(-0.6, 5);
    expect(direction.z).toBeCloseTo(0.8, 5);
  });

  it('falls back to the deployment inward direction when no threat is available', () => {
    const direction = openingViewDirection(0, 0, undefined, 3);
    expect(direction.x).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(direction.z).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe('RTS camera screen-edge pan', () => {
  it('does not pan while the cursor is outside the edge zones', () => {
    expect(getEdgePanInput(640, 360, 1280, 720)).toEqual({ x: 0, forward: 0 });
    expect(getEdgePanInput(100, 100, 1280, 720)).toEqual({ x: 0, forward: 0 });
  });

  it('uses the expanded mouse-only navigation zone', () => {
    expect(getEdgePanInput(80, 360, 1280, 720).x).toBeLessThan(0);
    expect(getEdgePanInput(1200, 360, 1280, 720).x).toBeGreaterThan(0);
  });

  it('moves in the direction of every screen edge', () => {
    expect(getEdgePanInput(0, 360, 1280, 720)).toEqual({ x: -1, forward: 0 });
    expect(getEdgePanInput(1280, 360, 1280, 720)).toEqual({ x: 1, forward: 0 });
    expect(getEdgePanInput(640, 0, 1280, 720)).toEqual({ x: 0, forward: 1 });
    expect(getEdgePanInput(640, 720, 1280, 720)).toEqual({ x: 0, forward: -1 });
  });

  it('combines edges into diagonal corner movement', () => {
    expect(getEdgePanInput(0, 0, 1280, 720)).toEqual({ x: -1, forward: 1 });
    expect(getEdgePanInput(0, 720, 1280, 720)).toEqual({ x: -1, forward: -1 });
  });

  it('accelerates continuously as the cursor approaches the outer edge', () => {
    const nearInnerEdge = Math.abs(getEdgePanInput(90, 360, 1280, 720).x);
    const halfway = Math.abs(getEdgePanInput(46.8, 360, 1280, 720).x);
    const outerEdge = Math.abs(getEdgePanInput(0, 360, 1280, 720).x);

    expect(nearInnerEdge).toBeGreaterThan(0);
    expect(halfway).toBeGreaterThan(nearInnerEdge);
    expect(outerEdge).toBeGreaterThan(halfway);
  });
});
