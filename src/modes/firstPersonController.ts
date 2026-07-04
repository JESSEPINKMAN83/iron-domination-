import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Input } from '../engine/input';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { manualFireAt } from '../sim/combat';
import type { GameSim } from '../sim/world';

type PossessionMode = 'rts' | 'entering' | 'fps' | 'exiting';
const FLIGHT_KEY_YAW_PER_TICK = 0.035;

interface CameraPose {
  position: Vector3;
  quaternion: Quaternion;
  fov: number;
}

export class FirstPersonController {
  private mode: PossessionMode = 'rts';
  private possessed?: Entity;
  private lookYaw = 0;
  private lookPitch = 0;
  private transitionT = 0;
  private fromPose?: CameraPose;
  private toPose?: CameraPose;
  private readonly poseCamera = new PerspectiveCamera();
  private readonly tmpForward = new Vector3();
  private readonly tmpHorizontal = new Vector3();
  private readonly tmpAimTarget = new Vector3();
  private readonly tmpCameraTarget = new Vector3();
  private readonly tmpEntityCenter = new Vector3();
  private readonly smoothFlightCenter = new Vector3();
  private hasSmoothFlightCenter = false;
  private savedCursor = '';

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: PerspectiveCamera,
    private readonly input: Input,
    private readonly hf: Heightfield,
    private readonly sim: GameSim,
    private readonly callbacks: { onEnter?: () => void; onExit?: (entity?: Entity) => void } = {},
  ) {
    dom.addEventListener(
      'pointerdown',
      (event) => {
        if (this.mode !== 'fps' || (event.button !== 0 && event.button !== 2)) return;
        event.preventDefault();
        event.stopPropagation();
        this.fire(event.button === 2 ? 'secondary' : 'primary');
      },
      { capture: true },
    );
  }

  get active(): boolean {
    return this.mode !== 'rts';
  }

  get inFirstPerson(): boolean {
    return this.mode === 'fps';
  }

  get possessedName(): string | undefined {
    return this.possessed?.name;
  }

  get possessedEntity(): Entity | undefined {
    return this.possessed;
  }

  enter(candidates: Entity[]): boolean {
    if (this.active) return false;
    const entity = candidates.find((candidate) => candidate.possessable && candidate.mover && !candidate.destroyed);
    if (!entity) return false;
    this.possessed = entity;
    this.lookYaw = entity.transform.rot;
    this.lookPitch = entity.flight ? MathUtils.degToRad(-7) : MathUtils.degToRad(-3);
    this.transitionT = 0;
    this.fromPose = this.captureCameraPose();
    this.hasSmoothFlightCenter = false;
    this.toPose = this.poseFor(entity, this.lookYaw, this.lookPitch, 62, 1, 1 / 60);
    entity.playerControlled = { throttle: 0, turn: 0, aimYaw: this.lookYaw, climb: 0 };
    this.mode = 'entering';
    this.savedCursor = this.dom.style.cursor;
    this.dom.style.cursor = 'none';
    this.callbacks.onEnter?.();
    void this.dom.requestPointerLock?.();
    return true;
  }

  exit(): void {
    if (!this.active) return;
    this.beginExit();
  }

  simTick(): void {
    if (!this.possessed?.playerControlled) return;
    if (this.possessed.destroyed) {
      this.beginExit();
      return;
    }
    const forward = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
    // heading uses (sin rot, cos rot): positive turn rotates toward -screen-right,
    // so D (turn right) must apply negative turn — matches mouse-look direction
    const turn = (this.input.isDown('KeyA') ? 1 : 0) - (this.input.isDown('KeyD') ? 1 : 0);
    if (this.possessed.flight && turn !== 0) this.lookYaw = normalizeAngle(this.lookYaw + turn * FLIGHT_KEY_YAW_PER_TICK);
    const climb = (this.input.isDown('Space') ? 1 : 0) - (this.input.isDown('ControlLeft') || this.input.isDown('ControlRight') ? 1 : 0);
    this.possessed.playerControlled.throttle = forward;
    this.possessed.playerControlled.turn = turn;
    this.possessed.playerControlled.aimYaw = this.lookYaw;
    this.possessed.playerControlled.climb = climb;
  }

  update(dt: number, alpha = 1): void {
    if (!this.active || !this.possessed) return;
    const delta = this.input.consumeMouseDelta();
    if (this.mode === 'fps' && (delta.dx !== 0 || delta.dy !== 0)) {
      this.lookYaw = normalizeAngle(this.lookYaw - delta.dx * 0.0024);
      const minPitch = this.possessed.flight ? MathUtils.degToRad(-42) : MathUtils.degToRad(-18);
      const maxPitch = this.possessed.flight ? MathUtils.degToRad(38) : MathUtils.degToRad(52);
      this.lookPitch = MathUtils.clamp(this.lookPitch - delta.dy * 0.0018, minPitch, maxPitch);
    }

    if (this.mode === 'entering') {
      this.transitionT = Math.min(1, this.transitionT + dt / 0.6);
      this.toPose = this.poseFor(this.possessed, this.lookYaw, this.lookPitch, 62, alpha, dt);
      this.applyPose(lerpPose(this.fromPose, this.toPose, ease(this.transitionT)));
      if (this.transitionT >= 1) this.mode = 'fps';
      return;
    }

    if (this.mode === 'exiting') {
      this.transitionT = Math.min(1, this.transitionT + dt / 0.42);
      this.applyPose(lerpPose(this.fromPose, this.toPose, ease(this.transitionT)));
      if (this.transitionT >= 1) this.finishExit();
      return;
    }

    const speed = this.possessed.velocity ? Math.hypot(this.possessed.velocity.x, this.possessed.velocity.z) : 0;
    this.applyPose(this.poseFor(this.possessed, this.lookYaw, this.lookPitch, this.possessed.flight ? MathUtils.lerp(62, 68, Math.min(1, speed / 46)) : 62, alpha, dt));
  }

  private beginExit(): void {
    if (!this.possessed || this.mode === 'exiting') return;
    this.fromPose = this.captureCameraPose();
    this.toPose = this.rtsPoseNear(this.possessed);
    this.transitionT = 0;
    this.mode = 'exiting';
    this.dom.style.cursor = this.savedCursor;
    document.exitPointerLock?.();
  }

  private finishExit(): void {
    const entity = this.possessed;
    if (entity) {
      delete entity.playerControlled;
      if (entity.velocity && !entity.flight) {
        entity.velocity.x = 0;
        entity.velocity.z = 0;
      }
    }
    this.possessed = undefined;
    this.hasSmoothFlightCenter = false;
    this.mode = 'rts';
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.dom.style.cursor = this.savedCursor;
    this.callbacks.onExit?.(entity);
  }

  private poseFor(entity: Entity, yaw: number, pitch: number, fov: number, alpha: number, dt: number): CameraPose {
    if (entity.flight) return this.flightPoseFor(entity, yaw, pitch, fov, alpha, dt);
    const center = this.interpolatedCenter(entity, alpha);
    const groundY = sampleHeight(this.hf, center.x, center.z);
    this.tmpForward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.tmpHorizontal.set(Math.sin(yaw), 0, Math.cos(yaw));
    const tankCenter = new Vector3(center.x, groundY + 2.4, center.z);
    const chaseDistance = 20;
    const chaseHeight = 8.6;
    const position = tankCenter.clone().addScaledVector(this.tmpHorizontal, -chaseDistance);
    position.y += chaseHeight;
    this.tmpAimTarget.copy(tankCenter).addScaledVector(this.tmpForward, 100);
    this.tmpAimTarget.y = Math.max(sampleHeight(this.hf, this.tmpAimTarget.x, this.tmpAimTarget.z) + 1.5, this.tmpAimTarget.y);
    return this.lookPose(position, this.tmpAimTarget, fov);
  }

  private flightPoseFor(entity: Entity, yaw: number, pitch: number, fov: number, alpha: number, dt: number): CameraPose {
    const aircraftCenter = this.interpolatedCenter(entity, alpha);
    this.tmpForward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.tmpHorizontal.set(Math.sin(yaw), 0, Math.cos(yaw));
    const targetCenter = new Vector3(aircraftCenter.x, aircraftCenter.y + 1.3, aircraftCenter.z);
    if (!this.hasSmoothFlightCenter) {
      this.smoothFlightCenter.copy(targetCenter);
      this.hasSmoothFlightCenter = true;
    } else {
      this.smoothFlightCenter.lerp(targetCenter, 1 - Math.exp(-dt * 16));
    }
    const center = this.smoothFlightCenter;
    const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
    const chaseDistance = MathUtils.lerp(15, 22, Math.min(1, speed / 46));
    const chaseHeight = MathUtils.lerp(5.4, 7.4, Math.min(1, speed / 46));
    const position = center.clone().addScaledVector(this.tmpHorizontal, -chaseDistance);
    position.y += chaseHeight;
    this.tmpAimTarget.copy(center).addScaledVector(this.tmpForward, 170);
    this.tmpCameraTarget.copy(center).addScaledVector(this.tmpForward, 80);
    return this.lookPose(position, this.tmpCameraTarget, fov);
  }

  private fire(slot: 'primary' | 'secondary'): void {
    if (!this.possessed) return;
    const target = this.possessed.flight ? this.flightTarget(this.possessed, slot) : slot === 'secondary' ? this.bombTarget(this.possessed) : this.tmpAimTarget;
    manualFireAt(this.sim, this.possessed, target.x, target.z, slot);
  }

  private flightTarget(entity: Entity, slot: 'primary' | 'secondary'): Vector3 {
    this.tmpForward.set(Math.sin(this.lookYaw) * Math.cos(this.lookPitch), Math.sin(this.lookPitch), Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
    if (slot === 'secondary') {
      return this.flightBombTarget(entity);
    }
    const origin = new Vector3(entity.transform.x, entity.transform.y ?? sampleHeight(this.hf, entity.transform.x, entity.transform.z) + 28, entity.transform.z);
    const range = 112;
    const target = origin.addScaledVector(this.tmpForward, range);
    target.y = sampleHeight(this.hf, target.x, target.z);
    return target;
  }

  private flightBombTarget(entity: Entity): Vector3 {
    const ground = this.terrainPoint();
    if (ground) return ground;
    const y = entity.transform.y ?? sampleHeight(this.hf, entity.transform.x, entity.transform.z) + 28;
    const origin = new Vector3(entity.transform.x, y, entity.transform.z);
    const horizontal = new Vector3(Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
    const pitchT = MathUtils.clamp((this.lookPitch - MathUtils.degToRad(-34)) / MathUtils.degToRad(72), 0, 1);
    const range = MathUtils.lerp(38, 430, pitchT);
    const target = origin.addScaledVector(horizontal, range);
    target.y = sampleHeight(this.hf, target.x, target.z);
    return target;
  }

  private bombTarget(entity: Entity): Vector3 {
    const groundY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
    const origin = new Vector3(entity.transform.x, groundY + 2.4, entity.transform.z);
    const horizontal = new Vector3(Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
    const pitchT = MathUtils.clamp((this.lookPitch - MathUtils.degToRad(-12)) / MathUtils.degToRad(64), 0, 1);
    const range = MathUtils.lerp(34, 430, pitchT);
    const target = origin.addScaledVector(horizontal, range);
    target.y = sampleHeight(this.hf, target.x, target.z);
    return target;
  }

  /*
   * Kept for later shell-drop/ground targeting. Manual cannon fire currently uses the turret
   * aim vector so the shot does not snap down to the near ground in chase camera.
   */
  private terrainPoint(): Vector3 | undefined {
    const origin = this.camera.position;
    const dir = new Vector3();
    this.camera.getWorldDirection(dir);
    let lo = 0;
    let hi = 260;
    let hit = false;
    const p = new Vector3();
    for (let i = 1; i <= 96; i++) {
      const t = (hi / 96) * i;
      p.copy(origin).addScaledVector(dir, t);
      if (p.y <= sampleHeight(this.hf, p.x, p.z) + 0.4) {
        hi = t;
        lo = Math.max(0, t - hi / 96);
        hit = true;
        break;
      }
    }
    if (!hit) return undefined;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      p.copy(origin).addScaledVector(dir, mid);
      if (p.y > sampleHeight(this.hf, p.x, p.z) + 0.4) lo = mid;
      else hi = mid;
    }
    return origin.clone().addScaledVector(dir, hi);
  }

  private rtsPoseNear(entity: Entity): CameraPose {
    const groundY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
    const target = new Vector3(entity.transform.x, entity.flight ? entity.transform.y ?? groundY + 28 : groundY, entity.transform.z);
    const yaw = this.lookYaw;
    const pitch = MathUtils.degToRad(50);
    const offset = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(Math.cos(pitch) * 70);
    offset.y = Math.sin(pitch) * 70;
    const position = target.clone().add(offset);
    return this.lookPose(position, target, 50);
  }

  private lookPose(position: Vector3, target: Vector3, fov: number): CameraPose {
    this.poseCamera.position.copy(position);
    this.poseCamera.lookAt(target);
    return { position: position.clone(), quaternion: this.poseCamera.quaternion.clone(), fov };
  }

  private interpolatedCenter(entity: Entity, alpha: number): Vector3 {
    const x = MathUtils.lerp(entity.previousTransform.x, entity.transform.x, alpha);
    const z = MathUtils.lerp(entity.previousTransform.z, entity.transform.z, alpha);
    const fallbackY = entity.flight ? sampleHeight(this.hf, x, z) + entity.flight.cruiseAltitude : sampleHeight(this.hf, x, z);
    const previousY = entity.previousTransform.y ?? entity.transform.y ?? fallbackY;
    const currentY = entity.transform.y ?? fallbackY;
    return this.tmpEntityCenter.set(x, MathUtils.lerp(previousY, currentY, alpha), z);
  }

  private captureCameraPose(): CameraPose {
    return { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), fov: this.camera.fov };
  }

  private applyPose(pose: CameraPose): void {
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
    if (Math.abs(this.camera.fov - pose.fov) > 0.01) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }
}

function lerpPose(from: CameraPose | undefined, to: CameraPose | undefined, t: number): CameraPose {
  if (!from || !to) throw new Error('missing camera transition pose');
  return {
    position: from.position.clone().lerp(to.position, t),
    quaternion: from.quaternion.clone().slerp(to.quaternion, t),
    fov: MathUtils.lerp(from.fov, to.fov, t),
  };
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
