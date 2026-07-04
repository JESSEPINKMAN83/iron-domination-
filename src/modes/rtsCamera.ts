// Classic RTS camera: keyboard/edge pan, Space + mouse grab pan,
// wheel zoom (28–140), Q/E 90° rotation, saved Command-left-drag free look,
// smooth exponential damping. The look-target follows terrain height.
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Input } from '../engine/input';
import { sampleHeight, type Heightfield } from '../sim/heightfield';

export const ZOOM_MIN = 28;
export const ZOOM_MAX = 140;
const PITCH_NEAR = MathUtils.degToRad(46);
const PITCH_FAR = MathUtils.degToRad(62);
const PITCH_MIN = MathUtils.degToRad(7);
const PITCH_MAX = MathUtils.degToRad(82);
const PITCH_OFFSET_MIN = MathUtils.degToRad(-58);
const PITCH_OFFSET_MAX = MathUtils.degToRad(28);
const PITCH_STORAGE_KEY = 'iron-dominion.rtsCamera.pitchOffset';
const YAW_STORAGE_KEY = 'iron-dominion.rtsCamera.yaw';
const EDGE_MARGIN = 14;

function damp(current: number, goal: number, lambda: number, dt: number): number {
  return goal + (current - goal) * Math.exp(-lambda * dt);
}

export class RtsCameraRig {
  private readonly goal = new Vector3(0, 0, 0);
  private readonly target = new Vector3(0, 0, 0);
  private yaw = readSavedYaw();
  private yawGoal = this.yaw;
  private dist = 90;
  private distGoal = 90;
  private pitchOffset = readSavedPitchOffset();
  private pitchOffsetGoal = this.pitchOffset;
  private grabSuppressed = false;

  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly camOffset = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly input: Input,
    private readonly hf: Heightfield,
  ) {
    input.onKeyDown('KeyQ', () => {
      this.yawGoal += Math.PI / 2;
    });
    input.onKeyDown('KeyE', () => {
      this.yawGoal -= Math.PI / 2;
    });
  }

  get distance(): number {
    return this.dist;
  }

  get yawDegrees(): number {
    return MathUtils.radToDeg(this.yaw);
  }

  get yawRadians(): number {
    return this.yaw;
  }

  get pitchDegrees(): number {
    return MathUtils.radToDeg(this.currentPitch());
  }

  getGroundViewportFootprint(): { x: number; z: number }[] {
    const halfFov = MathUtils.degToRad(this.camera.fov) / 2;
    const halfWidth = Math.tan(halfFov) * this.dist * this.camera.aspect * 1.05;
    const halfDepth = Math.tan(halfFov) * this.dist * 1.35;
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const corner = (rightScale: number, fwdScale: number) => ({
      x: this.clampToMap(this.target.x + rightX * rightScale + fwdX * fwdScale),
      z: this.clampToMap(this.target.z + rightZ * rightScale + fwdZ * fwdScale),
    });
    return [
      corner(-halfWidth, -halfDepth),
      corner(halfWidth, -halfDepth),
      corner(halfWidth, halfDepth),
      corner(-halfWidth, halfDepth),
    ];
  }

  jumpTo(x: number, z: number): void {
    const bound = this.hf.size / 2 - 10;
    const clampedX = MathUtils.clamp(x, -bound, bound);
    const clampedZ = MathUtils.clamp(z, -bound, bound);
    const y = Math.max(sampleHeight(this.hf, clampedX, clampedZ), this.hf.waterLevel);
    this.goal.set(clampedX, y, clampedZ);
    this.target.copy(this.goal);
  }

  setGrabSuppressed(suppressed: boolean): void {
    this.grabSuppressed = suppressed;
  }

  update(dt: number): void {
    const input = this.input;

    const wheel = input.consumeWheel();
    if (wheel !== 0) {
      this.distGoal = MathUtils.clamp(this.distGoal * Math.exp(wheel * 0.0012), ZOOM_MIN, ZOOM_MAX);
    }

    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Command-left drag freely aims the RTS camera and persists the preference.
    const lookAdjusting = input.isCommandLookModifierDown() && input.isButton(0);
    // Holding Space turns mouse movement into grab-pan. Clicks are suppressed by RtsController.
    const grabbing = !this.grabSuppressed && !lookAdjusting && input.isDown('Space');
    const delta = input.consumeMouseDelta();
    if (lookAdjusting && (delta.dx !== 0 || delta.dy !== 0)) {
      this.yawGoal = normalizeAngle(this.yawGoal - delta.dx * 0.006);
      this.pitchOffsetGoal = MathUtils.clamp(this.pitchOffsetGoal + delta.dy * 0.003, PITCH_OFFSET_MIN, PITCH_OFFSET_MAX);
      this.yaw = this.yawGoal;
      this.pitchOffset = this.pitchOffsetGoal;
      saveLook(this.yawGoal, this.pitchOffsetGoal);
    }
    if (grabbing && (delta.dx !== 0 || delta.dy !== 0)) {
      const worldPerPixel = (2 * this.dist * Math.tan(MathUtils.degToRad(this.camera.fov) / 2)) / window.innerHeight;
      this.goal.addScaledVector(this.right, -delta.dx * worldPerPixel);
      this.goal.addScaledVector(this.fwd, delta.dy * worldPerPixel);
    }

    // keyboard + screen-edge pan
    let mx = 0;
    let my = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) my += 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) my -= 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) mx -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) mx += 1;
    if (!grabbing && !lookAdjusting && input.pointerInWindow && document.hasFocus()) {
      if (input.mouseX <= EDGE_MARGIN) mx -= 1;
      if (input.mouseX >= window.innerWidth - EDGE_MARGIN) mx += 1;
      if (input.mouseY <= EDGE_MARGIN) my += 1;
      if (input.mouseY >= window.innerHeight - EDGE_MARGIN) my -= 1;
    }
    if (mx !== 0 || my !== 0) {
      const speed = (this.dist * 0.9 + 12) / Math.hypot(mx, my);
      this.goal.addScaledVector(this.right, mx * speed * dt);
      this.goal.addScaledVector(this.fwd, my * speed * dt);
    }

    const bound = this.hf.size / 2 - 10;
    this.goal.x = MathUtils.clamp(this.goal.x, -bound, bound);
    this.goal.z = MathUtils.clamp(this.goal.z, -bound, bound);
    this.goal.y = Math.max(sampleHeight(this.hf, this.goal.x, this.goal.z), this.hf.waterLevel);

    this.target.x = damp(this.target.x, this.goal.x, 9, dt);
    this.target.z = damp(this.target.z, this.goal.z, 9, dt);
    this.target.y = damp(this.target.y, this.goal.y, 5, dt);
    this.yaw = dampAngle(this.yaw, this.yawGoal, 7, dt);
    this.dist = damp(this.dist, this.distGoal, 7, dt);
    this.pitchOffset = damp(this.pitchOffset, this.pitchOffsetGoal, 9, dt);

    const pitch = this.currentPitch();
    this.camOffset.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(Math.cos(pitch) * this.dist);
    this.camOffset.y = Math.sin(pitch) * this.dist;

    this.camera.position.copy(this.target).add(this.camOffset);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private currentPitch(): number {
    const zoomT = (this.dist - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
    return MathUtils.clamp(MathUtils.lerp(PITCH_NEAR, PITCH_FAR, zoomT) + this.pitchOffset, PITCH_MIN, PITCH_MAX);
  }

  private clampToMap(value: number): number {
    const bound = this.hf.size / 2;
    return MathUtils.clamp(value, -bound, bound);
  }
}

function readSavedPitchOffset(): number {
  const raw = window.localStorage.getItem(PITCH_STORAGE_KEY);
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) ? MathUtils.clamp(n, PITCH_OFFSET_MIN, PITCH_OFFSET_MAX) : 0;
}

function readSavedYaw(): number {
  const raw = window.localStorage.getItem(YAW_STORAGE_KEY);
  const n = raw === null ? Math.PI * 0.25 : Number(raw);
  return Number.isFinite(n) ? normalizeAngle(n) : Math.PI * 0.25;
}

function saveLook(yaw: number, pitchOffset: number): void {
  window.localStorage.setItem(YAW_STORAGE_KEY, String(normalizeAngle(yaw)));
  window.localStorage.setItem(PITCH_STORAGE_KEY, String(pitchOffset));
}

function dampAngle(current: number, goal: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(goal - current), Math.cos(goal - current));
  return normalizeAngle(current + delta * (1 - Math.exp(-lambda * dt)));
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
