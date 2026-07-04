import { MathUtils, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Input } from '../engine/input';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';

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
  private readonly poseTarget = new Object3D();
  private readonly tmpForward = new Vector3();

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: PerspectiveCamera,
    private readonly input: Input,
    private readonly hf: Heightfield,
    private readonly callbacks: { onEnter?: () => void; onExit?: (entity?: Entity) => void } = {},
  ) {}

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
    this.lookYaw = entity.turret?.yaw ?? entity.transform.rot;
    this.lookPitch = 0;
    this.transitionT = 0;
    this.fromPose = this.captureCameraPose();
    this.toPose = this.poseFor(entity, this.lookYaw, this.lookPitch, 75);
    entity.playerControlled = { throttle: 0, turn: 0, aimYaw: this.lookYaw };
    this.mode = 'entering';
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
      this.toPose = this.poseFor(this.possessed, this.lookYaw, this.lookPitch, 75);
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

    this.applyPose(this.poseFor(this.possessed, this.lookYaw, this.lookPitch, this.input.isButton(2) ? 42 : 75));
  }

  private beginExit(): void {
    if (!this.possessed || this.mode === 'exiting') return;
    this.fromPose = this.captureCameraPose();
    this.toPose = this.rtsPoseNear(this.possessed);
    this.transitionT = 0;
    this.mode = 'exiting';
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
    this.callbacks.onExit?.(entity);
  }

  private poseFor(entity: Entity, yaw: number, pitch: number, fov: number): CameraPose {
    const socketHeight = entity.possessable?.socketHeight ?? 2.2;
    const groundY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
    const hullForwardX = Math.sin(entity.transform.rot);
    const hullForwardZ = Math.cos(entity.transform.rot);
    const position = new Vector3(entity.transform.x + hullForwardX * 1.2, groundY + socketHeight, entity.transform.z + hullForwardZ * 1.2);
    this.tmpForward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    return this.lookPose(position, position.clone().add(this.tmpForward), fov);
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
    this.poseTarget.position.copy(position);
    this.poseTarget.lookAt(target);
    return { position: position.clone(), quaternion: this.poseTarget.quaternion.clone(), fov };
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
