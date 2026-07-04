import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Input } from '../engine/input';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { manualFireAt } from '../sim/combat';
import { issueMoveOrder, setSelected, type GameSim } from '../sim/world';
import { FLIGHT_MODELS } from '../content/flightModels';

type PossessionMode = 'rts' | 'entering' | 'fps' | 'exiting';
const CHASE_ZOOM_MIN = -1;
const CHASE_ZOOM_MAX = 3.15;
const ORBIT_PITCH_MIN = MathUtils.degToRad(-18);
const ORBIT_PITCH_MAX = MathUtils.degToRad(48);
const SQUAD_FOLLOW_REFRESH_TICKS = 12;
const SQUAD_FOLLOW_MIN_DISTANCE = 14;

interface CameraPose {
  position: Vector3;
  quaternion: Quaternion;
  fov: number;
}

export class FirstPersonController {
  private mode: PossessionMode = 'rts';
  private possessed?: Entity;
  private squad: Entity[] = [];
  private squadIndex = 0;
  private nextSquadFollowTick = 0;
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
  private readonly tmpVelocityDir = new Vector3();
  private readonly smoothFlightCenter = new Vector3();
  private hasSmoothFlightCenter = false;
  private chaseZoom = 0;
  private orbitYaw = 0;
  private orbitPitch = 0;
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
        if (event.button === 0 && (event.metaKey || this.input.isMetaDown())) return;
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
    if (!this.possessed) return undefined;
    return this.squad.length > 1 ? `${this.possessed.name ?? 'unit'} ${this.squadIndex + 1}/${this.squad.length}` : this.possessed.name;
  }

  get possessedEntity(): Entity | undefined {
    return this.possessed;
  }

  enter(candidates: Entity[]): boolean {
    if (this.active) return false;
    const squad = candidates.filter((candidate) => candidate.possessable && candidate.mover && !candidate.destroyed);
    const entity = squad.length > 0 ? squad[this.sim.tick % squad.length] : undefined;
    if (!entity) return false;
    this.squad = squad;
    this.squadIndex = squad.indexOf(entity);
    this.nextSquadFollowTick = this.sim.tick;
    setSelected(this.sim, this.squad);
    this.takeControl(entity);
    this.transitionT = 0;
    this.fromPose = this.captureCameraPose();
    this.hasSmoothFlightCenter = false;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.toPose = this.poseFor(entity, this.lookYaw, this.lookPitch, 62, 1, 1 / 60);
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

  cyclePossessed(direction = 1): boolean {
    if (!this.active || this.squad.length <= 1) return false;
    const alive = this.liveSquad();
    if (alive.length <= 1) return false;
    const current = this.possessed;
    const currentIndex = current ? alive.indexOf(current) : -1;
    const nextIndex = (currentIndex + direction + alive.length) % alive.length;
    const next = alive[nextIndex];
    this.squad = alive;
    this.takeControl(next);
    this.squadIndex = nextIndex;
    this.hasSmoothFlightCenter = false;
    this.nextSquadFollowTick = this.sim.tick;
    this.toPose = this.poseFor(next, this.lookYaw, this.lookPitch, this.zoomedFov(62), 1, 1 / 60);
    setSelected(this.sim, this.squad);
    return true;
  }

  simTick(): void {
    if (!this.possessed?.playerControlled) return;
    if (this.possessed.destroyed) {
      if (!this.cyclePossessed(1)) this.beginExit();
      return;
    }
    const forward = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
    // heading uses (sin rot, cos rot): positive turn rotates toward -screen-right,
    // so D (turn right) must apply negative turn — matches mouse-look direction
    const turn = (this.input.isDown('KeyA') ? 1 : 0) - (this.input.isDown('KeyD') ? 1 : 0);
    const strafe = this.possessed.flight ? (this.input.isDown('KeyE') ? 1 : 0) - (this.input.isDown('KeyQ') ? 1 : 0) : 0;
    const climb = (this.input.isDown('Space') ? 1 : 0) - (this.input.isDown('ControlLeft') || this.input.isDown('ControlRight') ? 1 : 0);
    this.possessed.playerControlled.throttle = forward;
    this.possessed.playerControlled.turn = turn;
    this.possessed.playerControlled.aimYaw = this.lookYaw;
    this.possessed.playerControlled.climb = climb;
    this.possessed.playerControlled.strafe = strafe;
    this.updateSquadFollowers();
  }

  update(dt: number, alpha = 1): void {
    if (!this.active || !this.possessed) return;
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) this.chaseZoom = MathUtils.clamp(this.chaseZoom + wheel * 0.0014, CHASE_ZOOM_MIN, CHASE_ZOOM_MAX);
    const delta = this.input.consumeMouseDelta();
    const orbitAdjusting = this.mode === 'fps' && this.input.isMetaDown() && this.input.isButton(0);
    if (this.mode === 'fps' && (delta.dx !== 0 || delta.dy !== 0)) {
      if (orbitAdjusting) {
        this.orbitYaw = normalizeAngle(this.orbitYaw - delta.dx * 0.004);
        this.orbitPitch = MathUtils.clamp(this.orbitPitch - delta.dy * 0.003, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX);
      } else {
        this.lookYaw = normalizeAngle(this.lookYaw - delta.dx * 0.0024);
        const minPitch = this.possessed.flight ? MathUtils.degToRad(-42) : MathUtils.degToRad(-18);
        const maxPitch = this.possessed.flight ? MathUtils.degToRad(38) : MathUtils.degToRad(52);
        this.lookPitch = MathUtils.clamp(this.lookPitch - delta.dy * 0.0018, minPitch, maxPitch);
      }
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
    const maxSpeed = this.possessed.flight ? FLIGHT_MODELS[this.possessed.flight.model].maxSpeed : 46;
    const baseFov = this.possessed.flight ? MathUtils.lerp(62, 70, Math.min(1, speed / maxSpeed)) : 62;
    this.applyPose(this.poseFor(this.possessed, this.lookYaw, this.lookPitch, this.zoomedFov(baseFov), alpha, dt));
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
    this.squad = [];
    this.squadIndex = 0;
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
    const cameraYaw = yaw + this.orbitYaw;
    const cameraPitch = MathUtils.clamp(MathUtils.degToRad(24) + this.orbitPitch, MathUtils.degToRad(6), MathUtils.degToRad(64));
    this.tmpHorizontal.set(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    const chaseDistance = 20 * this.zoomScale();
    const horizontalDistance = chaseDistance * Math.cos(cameraPitch);
    const chaseHeight = Math.max(2.8, chaseDistance * Math.sin(cameraPitch) + 1.2);
    const position = tankCenter.clone().addScaledVector(this.tmpHorizontal, -horizontalDistance);
    position.y += chaseHeight;
    this.tmpAimTarget.copy(tankCenter).addScaledVector(this.tmpForward, 100);
    this.tmpAimTarget.y = Math.max(sampleHeight(this.hf, this.tmpAimTarget.x, this.tmpAimTarget.z) + 1.5, this.tmpAimTarget.y);
    return this.lookPose(position, this.tmpAimTarget, fov);
  }

  private flightPoseFor(entity: Entity, yaw: number, pitch: number, fov: number, alpha: number, dt: number): CameraPose {
    const aircraftCenter = this.interpolatedCenter(entity, alpha);
    this.tmpForward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.tmpHorizontal.set(Math.sin(yaw), 0, Math.cos(yaw));
    const speed = entity.velocity ? Math.hypot(entity.velocity.x, entity.velocity.z) : 0;
    const model = FLIGHT_MODELS[entity.flight!.model];
    if (entity.velocity && speed > 1) this.tmpVelocityDir.set(entity.velocity.x / speed, 0, entity.velocity.z / speed);
    else this.tmpVelocityDir.copy(this.tmpHorizontal);
    const velocityYaw = Math.atan2(this.tmpVelocityDir.x, this.tmpVelocityDir.z);
    const lookBackT = MathUtils.smoothstep(Math.abs(normalizeAngle(yaw - velocityYaw)), 0.8, 2.35);
    const driftBlend = Math.min(0.65, (speed / 8) * 0.65) * (1 - lookBackT * 0.88);
    this.tmpVelocityDir.lerp(this.tmpHorizontal, 1 - driftBlend).normalize();
    const targetCenter = new Vector3(aircraftCenter.x, aircraftCenter.y + 1.3, aircraftCenter.z);
    if (!this.hasSmoothFlightCenter) {
      this.smoothFlightCenter.copy(targetCenter);
      this.hasSmoothFlightCenter = true;
    } else {
      this.smoothFlightCenter.lerp(targetCenter, 1 - Math.exp(-dt * 4.5));
    }
    const center = this.smoothFlightCenter;
    const speedT = Math.min(1, speed / model.maxSpeed);
    const followYaw = Math.atan2(this.tmpVelocityDir.x, this.tmpVelocityDir.z) + this.orbitYaw;
    this.tmpVelocityDir.set(Math.sin(followYaw), 0, Math.cos(followYaw));
    const chaseDistance = MathUtils.lerp(14, 19, speedT) * this.zoomScale();
    const flightOrbitPitch = MathUtils.clamp(this.orbitPitch, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX);
    const horizontalDistance = chaseDistance * Math.cos(flightOrbitPitch * 0.72);
    const chaseHeight = MathUtils.lerp(5.2, 7.1, speedT) + Math.sin(flightOrbitPitch) * chaseDistance * 0.72;
    const position = center.clone().addScaledVector(this.tmpVelocityDir, -horizontalDistance);
    position.y += Math.max(2.6, chaseHeight);
    this.tmpAimTarget.copy(center).addScaledVector(this.tmpForward, 170);
    this.tmpCameraTarget.copy(center).addScaledVector(this.tmpForward, 80);
    const cameraRoll = MathUtils.clamp((entity.flight?.rollAttitude ?? 0) * 0.3, MathUtils.degToRad(-8), MathUtils.degToRad(8));
    return this.lookPose(position, this.tmpCameraTarget, fov, -cameraRoll);
  }

  private fire(slot: 'primary' | 'secondary'): void {
    if (!this.possessed) return;
    const target = this.possessed.flight ? this.flightTarget(this.possessed, slot) : slot === 'secondary' ? this.bombTarget(this.possessed) : this.tmpAimTarget;
    manualFireAt(this.sim, this.possessed, target.x, target.z, slot, target.y);
    for (const wingman of this.squadFollowers()) {
      if (wingman.turret) wingman.turret.yaw = Math.atan2(target.x - wingman.transform.x, target.z - wingman.transform.z);
      manualFireAt(this.sim, wingman, target.x, target.z, slot, target.y);
      if (slot === 'secondary') manualFireAt(this.sim, wingman, target.x, target.z, 'primary', target.y);
    }
  }

  private flightTarget(entity: Entity, slot: 'primary' | 'secondary'): Vector3 {
    this.tmpForward.set(Math.sin(this.lookYaw) * Math.cos(this.lookPitch), Math.sin(this.lookPitch), Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
    if (slot === 'secondary') {
      return this.flightBombTarget(entity);
    }
    const origin = new Vector3(entity.transform.x, entity.transform.y ?? sampleHeight(this.hf, entity.transform.x, entity.transform.z) + 28, entity.transform.z);
    const range = 112;
    const target = origin.addScaledVector(this.tmpForward, range);
    target.y = Math.max(sampleHeight(this.hf, target.x, target.z) + 1.5, target.y);
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

  private zoomScale(): number {
    return Math.exp(this.chaseZoom * 0.55);
  }

  private zoomedFov(baseFov: number): number {
    return MathUtils.clamp(baseFov + this.chaseZoom * 3.2, 48, 76);
  }

  private takeControl(entity: Entity): void {
    if (this.possessed && this.possessed !== entity) delete this.possessed.playerControlled;
    this.possessed = entity;
    this.lookYaw = entity.transform.rot;
    this.lookPitch = entity.flight ? MathUtils.degToRad(-7) : MathUtils.degToRad(-3);
    entity.playerControlled = { throttle: 0, turn: 0, aimYaw: this.lookYaw, climb: 0, strafe: 0 };
  }

  private liveSquad(): Entity[] {
    this.squad = this.squad.filter((entity) => this.sim.world.has(entity) && entity.possessable && entity.mover && !entity.destroyed);
    return this.squad;
  }

  private squadFollowers(): Entity[] {
    return this.liveSquad().filter((entity) => entity !== this.possessed && entity.mover && !entity.playerControlled);
  }

  private updateSquadFollowers(): void {
    if (!this.possessed || this.squad.length <= 1 || this.sim.tick < this.nextSquadFollowTick) return;
    this.nextSquadFollowTick = this.sim.tick + SQUAD_FOLLOW_REFRESH_TICKS;
    const followers = this.squadFollowers();
    if (followers.length === 0) return;
    const leaderSpeed = this.possessed.velocity ? Math.hypot(this.possessed.velocity.x, this.possessed.velocity.z) : 0;
    const shouldRefresh = followers.some((entity) => {
      const dx = entity.transform.x - this.possessed!.transform.x;
      const dz = entity.transform.z - this.possessed!.transform.z;
      return Math.hypot(dx, dz) > SQUAD_FOLLOW_MIN_DISTANCE || leaderSpeed > 1.5 || entity.mover?.target === undefined;
    });
    if (!shouldRefresh) return;
    issueMoveOrder(this.sim, followers, this.possessed.transform.x, this.possessed.transform.z, false, this.possessed.transform.rot);
  }

  private lookPose(position: Vector3, target: Vector3, fov: number, roll = 0): CameraPose {
    this.poseCamera.position.copy(position);
    this.poseCamera.lookAt(target);
    if (roll !== 0) this.poseCamera.rotateZ(roll);
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
