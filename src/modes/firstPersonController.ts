import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Input } from '../engine/input';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { manualFireAt } from '../sim/combat';
import type { GameSim } from '../sim/world';

type PossessionMode = 'rts' | 'entering' | 'fps' | 'exiting';

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
  private readonly tmpAimTarget = new Vector3();
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
      'mousedown',
      (event) => {
        if (this.mode !== 'fps' || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.fire();
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
    this.lookPitch = MathUtils.degToRad(-6);
    this.transitionT = 0;
    this.fromPose = this.captureCameraPose();
    this.toPose = this.poseFor(entity, this.lookYaw, this.lookPitch, 62);
    entity.playerControlled = { throttle: 0, turn: 0, aimYaw: this.lookYaw };
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
    const turn = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);
    this.possessed.playerControlled.throttle = forward;
    this.possessed.playerControlled.turn = turn;
    this.possessed.playerControlled.aimYaw = this.lookYaw;
  }

  update(dt: number): void {
    if (!this.active || !this.possessed) return;
    const delta = this.input.consumeMouseDelta();
    if (this.mode === 'fps' && (delta.dx !== 0 || delta.dy !== 0)) {
      this.lookYaw = normalizeAngle(this.lookYaw - delta.dx * 0.0024);
      this.lookPitch = MathUtils.clamp(this.lookPitch - delta.dy * 0.0018, MathUtils.degToRad(-18), MathUtils.degToRad(14));
    }

    if (this.mode === 'entering') {
      this.transitionT = Math.min(1, this.transitionT + dt / 0.6);
      this.toPose = this.poseFor(this.possessed, this.lookYaw, this.lookPitch, 62);
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

    this.applyPose(this.poseFor(this.possessed, this.lookYaw, this.lookPitch, this.input.isButton(2) ? 38 : 62));
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
      if (entity.velocity) {
        entity.velocity.x = 0;
        entity.velocity.z = 0;
      }
    }
    this.possessed = undefined;
    this.mode = 'rts';
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.dom.style.cursor = this.savedCursor;
    this.callbacks.onExit?.(entity);
  }

  private poseFor(entity: Entity, yaw: number, pitch: number, fov: number): CameraPose {
    const groundY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
    this.tmpForward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const tankCenter = new Vector3(entity.transform.x, groundY + 2.4, entity.transform.z);
    const chaseDistance = this.input.isButton(2) ? 14 : 22;
    const chaseHeight = this.input.isButton(2) ? 6.8 : 10.2;
    const position = tankCenter.clone().addScaledVector(this.tmpForward, -chaseDistance);
    position.y += chaseHeight - this.tmpForward.y * 2;
    const target = tankCenter.clone().addScaledVector(this.tmpForward, 3.8);
    target.y -= 1.15;
    this.tmpAimTarget.copy(tankCenter).addScaledVector(this.tmpForward, 96);
    this.tmpAimTarget.y += Math.sin(pitch) * 36;
    return this.lookPose(position, target, fov);
  }

  private fire(): void {
    if (!this.possessed) return;
    manualFireAt(this.sim, this.possessed, this.tmpAimTarget.x, this.tmpAimTarget.z);
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
    const target = new Vector3(entity.transform.x, groundY, entity.transform.z);
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
