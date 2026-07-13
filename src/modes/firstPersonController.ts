import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Input } from '../engine/input';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import { manualFireAt } from '../sim/combat';
import { issueMoveOrder, setSelected, type GameSim } from '../sim/world';
import { FLIGHT_MODELS } from '../content/flightModels';
import { hasUnitUpgrade, specialUpgradeForEntity } from '../sim/upgrades';

type PossessionMode = 'rts' | 'entering' | 'fps' | 'exiting';
const CHASE_ZOOM_MIN = -1;
const CHASE_ZOOM_MAX = 3.15;
const ORBIT_PITCH_MIN = MathUtils.degToRad(-18);
const ORBIT_PITCH_MAX = MathUtils.degToRad(48);
const FLIGHT_LOOK_DOWN_MIN = MathUtils.degToRad(-86);
const FLIGHT_LOOK_UP_MAX = MathUtils.degToRad(56);
const GROUND_LOOK_DOWN_MIN = MathUtils.degToRad(-82);
const GROUND_LOOK_UP_MAX = MathUtils.degToRad(70);
const SNIPER_SCOPE_FOV_WIDE = 30;
const SNIPER_SCOPE_FOV_TIGHT = 11;
const SQUAD_FOLLOW_REFRESH_TICKS = 12;
const SQUAD_FOLLOW_MIN_DISTANCE = 14;

interface CameraPose {
  position: Vector3;
  quaternion: Quaternion;
  fov: number;
}

export interface FirstPersonCommandSink {
  control(command: {
    id: number;
    throttle: number;
    turn: number;
    aimYaw: number;
    climb?: number;
    strafe?: number;
    boost?: boolean;
    x: number;
    z: number;
    y?: number;
    rot: number;
    vx?: number;
    vz?: number;
  }): void;
  fire(command: { id: number; slot: 'primary' | 'secondary' | 'special'; x: number; z: number; y?: number; aimYaw: number }): void;
  release(id: number): void;
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
  private sniperScopeZoom = 0.35;
  private sniperScopeActive = false;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private savedCursor = '';
  private readonly scopeOverlay: HTMLDivElement;
  private readonly scopeStatus: HTMLDivElement;
  private readonly artilleryPreview: HTMLCanvasElement;
  private readonly abilityStatus: HTMLDivElement;
  private readonly abilityHud: HTMLDivElement;
  private abilityStatusTimer = 0;
  private sniperReloadFlash = 0;
  private lastControlSentTick = -999;
  private lastControlSignature = '';

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: PerspectiveCamera,
    private readonly input: Input,
    private readonly hf: Heightfield,
    private readonly sim: GameSim,
    private readonly callbacks: { onEnter?: () => void; onExit?: (entity?: Entity) => void } = {},
    private readonly localTeam = 1,
    private readonly commandSink?: FirstPersonCommandSink,
  ) {
    this.scopeOverlay = document.createElement('div');
    this.scopeOverlay.style.cssText =
      'position:fixed;inset:0;display:none;pointer-events:none;z-index:12;' +
      'background:radial-gradient(circle at center, transparent 0 16%, rgba(0,0,0,.16) 17%, rgba(0,0,0,.72) 43%, rgba(0,0,0,.92) 100%);';
    this.scopeOverlay.innerHTML =
      '<div style="position:absolute;left:50%;top:50%;width:min(54vw,54vh);height:min(54vw,54vh);transform:translate(-50%,-50%);border:2px solid rgba(185,230,190,.72);border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.9),inset 0 0 34px rgba(90,255,130,.08)"></div>' +
      '<div style="position:absolute;left:50%;top:12%;bottom:12%;width:1px;background:rgba(198,244,204,.58);transform:translateX(-50%)"></div>' +
      '<div style="position:absolute;top:50%;left:12%;right:12%;height:1px;background:rgba(198,244,204,.58);transform:translateY(-50%)"></div>' +
      '<div style="position:absolute;left:50%;top:50%;width:8px;height:8px;border:1px solid rgba(240,248,230,.9);border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 14px rgba(125,242,125,.35)"></div>';
    document.body.appendChild(this.scopeOverlay);
    this.scopeStatus = document.createElement('div');
    this.scopeStatus.style.cssText =
      'position:fixed;left:50%;bottom:18%;transform:translateX(-50%);display:none;pointer-events:none;z-index:13;' +
      'font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.18em;color:rgba(216,255,208,.9);text-shadow:0 1px 2px #000;';
    document.body.appendChild(this.scopeStatus);
    this.artilleryPreview = document.createElement('canvas');
    this.artilleryPreview.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;display:none;pointer-events:none;z-index:11;';
    document.body.appendChild(this.artilleryPreview);
    this.abilityStatus = document.createElement('div');
    this.abilityStatus.style.cssText =
      'position:fixed;left:50%;bottom:11%;transform:translateX(-50%);display:none;pointer-events:none;z-index:14;' +
      'padding:7px 11px;border:1px solid rgba(210,177,95,.72);background:rgba(8,12,12,.86);color:#f0d56a;' +
      'font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-shadow:0 1px 2px #000;';
    document.body.appendChild(this.abilityStatus);
    this.abilityHud = document.createElement('div');
    this.abilityHud.style.cssText =
      'position:fixed;right:20px;bottom:58px;display:none;pointer-events:none;z-index:13;padding:7px 10px;' +
      'border-left:3px solid #d2b15f;background:rgba(8,12,12,.76);color:#dbe5df;font:700 10px ui-monospace,Menlo,monospace;letter-spacing:.08em;';
    document.body.appendChild(this.abilityHud);

    dom.addEventListener(
      'pointerdown',
      (event) => {
        if (this.mode !== 'fps' || (event.button !== 0 && event.button !== 2)) return;
        event.preventDefault();
        event.stopPropagation();
        this.ensurePointerLock();
        if (event.button === 0 && (event.metaKey || this.input.isMetaDown())) return;
        if (event.button === 2 && this.isSniper(this.possessed)) {
          if (this.sniperBikeMoving(this.possessed)) {
            this.flashAbilityStatus('STOP COMBAT BIKE TO AIM');
            return;
          }
          this.sniperScopeActive = !this.sniperScopeActive;
          this.updateScopeOverlay(this.sniperScopeActive);
          return;
        }
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
    setSelected(this.sim, this.squad, false, this.localTeam);
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
    this.ensurePointerLock();
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
    setSelected(this.sim, this.squad, false, this.localTeam);
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
    const baseTurn = (this.input.isDown('KeyA') ? 1 : 0) - (this.input.isDown('KeyD') ? 1 : 0);
    const hardTurn = this.possessed.flight ? (this.input.isDown('KeyQ') ? 1 : 0) - (this.input.isDown('KeyE') ? 1 : 0) : 0;
    const turn = baseTurn + hardTurn * 1.55;
    const strafe = 0;
    const climb = (this.input.isDown('Space') ? 1 : 0) - (this.input.isDown('ControlLeft') || this.input.isDown('ControlRight') ? 1 : 0);
    const boost = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
    this.possessed.playerControlled.throttle = forward;
    this.possessed.playerControlled.turn = turn;
    this.possessed.playerControlled.aimYaw = this.lookYaw;
    this.possessed.playerControlled.climb = climb;
    this.possessed.playerControlled.strafe = strafe;
    this.possessed.playerControlled.boost = boost;
    this.publishControlState();
    this.updateSquadFollowers();
  }

  useSpecialAbility(): boolean {
    if (this.mode !== 'fps' || !this.possessed) return false;
    if (!this.possessed.specialWeapon) {
      this.flashAbilityStatus('SPECIAL LOCKED - BUY AN F ABILITY');
      return false;
    }
    if (this.possessed.specialWeapon.cooldown > 0) {
      this.flashAbilityStatus(`SPECIAL RECHARGING ${this.possessed.specialWeapon.cooldown.toFixed(1)}S`);
      return false;
    }
    if (this.sniperBikeMoving(this.possessed)) {
      this.flashAbilityStatus('STOP COMBAT BIKE TO FIRE');
      return false;
    }
    return this.fire('special');
  }

  update(dt: number, alpha = 1): void {
    if (!this.active || !this.possessed) return;
    const sniperScoped = this.isSniperScoped();
    this.sniperReloadFlash = Math.max(0, this.sniperReloadFlash - dt);
    this.abilityStatusTimer = Math.max(0, this.abilityStatusTimer - dt);
    if (this.abilityStatusTimer <= 0) this.abilityStatus.style.display = 'none';
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) {
      if (sniperScoped) this.sniperScopeZoom = MathUtils.clamp(this.sniperScopeZoom - wheel * 0.0018, 0, 1);
      else this.chaseZoom = MathUtils.clamp(this.chaseZoom + wheel * 0.0014, CHASE_ZOOM_MIN, CHASE_ZOOM_MAX);
    }
    this.updateScopeOverlay(sniperScoped);
    this.updateAbilityHud();
    const delta = this.input.consumeMouseDelta();
    const orbitAdjusting = this.mode === 'fps' && this.input.isMetaDown() && this.input.isButton(0);
    if (this.mode === 'fps' && (delta.dx !== 0 || delta.dy !== 0)) {
      if (orbitAdjusting) {
        this.orbitYaw -= delta.dx * 0.004;
        this.orbitPitch = MathUtils.clamp(this.orbitPitch - delta.dy * 0.003, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX);
      } else {
        this.lookYaw -= delta.dx * 0.0024;
        const minPitch = this.possessed.flight ? FLIGHT_LOOK_DOWN_MIN : GROUND_LOOK_DOWN_MIN;
        const maxPitch = this.possessed.flight ? FLIGHT_LOOK_UP_MAX : GROUND_LOOK_UP_MAX;
        this.lookPitch = MathUtils.clamp(this.lookPitch - delta.dy * 0.0018, minPitch, maxPitch);
      }
    }

    if (this.mode === 'entering') {
      this.transitionT = Math.min(1, this.transitionT + dt / 0.6);
      this.toPose = this.poseFor(this.possessed, this.lookYaw, this.lookPitch, 62, alpha, dt);
      this.applyPose(lerpPose(this.fromPose, this.toPose, ease(this.transitionT)));
      this.updateArtilleryPreview();
      if (this.transitionT >= 1) this.mode = 'fps';
      return;
    }

    if (this.mode === 'exiting') {
      this.updateScopeOverlay(false);
      this.transitionT = Math.min(1, this.transitionT + dt / 0.58);
      this.applyPose(lerpPose(this.fromPose, this.toPose, easeOutCubic(this.transitionT)));
      this.hideArtilleryPreview();
      if (this.transitionT >= 1) this.finishExit();
      return;
    }

    const speed = this.possessed.velocity ? Math.hypot(this.possessed.velocity.x, this.possessed.velocity.z) : 0;
    const maxSpeed = this.possessed.flight ? FLIGHT_MODELS[this.possessed.flight.model].maxSpeed : 46;
    const baseFov = this.possessed.flight ? MathUtils.lerp(62, 70, Math.min(1, speed / maxSpeed)) : 62;
    this.applyPose(this.poseFor(this.possessed, this.lookYaw, this.lookPitch, this.zoomedFov(baseFov), alpha, dt));
    this.updateArtilleryPreview();
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
      this.commandSink?.release(entity.id);
      if (entity.velocity && !entity.flight) {
        entity.velocity.x = 0;
        entity.velocity.z = 0;
      }
    }
    this.possessed = undefined;
    this.squad = [];
    this.squadIndex = 0;
    this.hasSmoothFlightCenter = false;
    this.sniperScopeActive = false;
    this.sniperReloadFlash = 0;
    this.abilityStatusTimer = 0;
    this.abilityStatus.style.display = 'none';
    this.abilityHud.style.display = 'none';
    this.updateScopeOverlay(false);
    this.hideArtilleryPreview();
    this.mode = 'rts';
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.dom.style.cursor = this.savedCursor;
    this.callbacks.onExit?.(entity);
  }

  private poseFor(entity: Entity, yaw: number, pitch: number, fov: number, alpha: number, dt: number): CameraPose {
    if (entity.flight) return this.flightPoseFor(entity, yaw, pitch, fov, alpha, dt);
    if (this.isSniper(entity)) return this.sniperPoseFor(entity, yaw, pitch, this.isSniperScoped(entity) ? undefined : this.zoomedFov(54));
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
    const terrainAim = this.rayTerrainPoint(tankCenter, this.tmpForward, this.hf.size * 1.6);
    if (terrainAim) this.tmpAimTarget.copy(terrainAim);
    else this.tmpAimTarget.copy(tankCenter).addScaledVector(this.tmpForward, this.hf.size * 1.5);
    return this.lookPose(position, this.tmpAimTarget, fov);
  }

  private sniperPoseFor(entity: Entity, yaw: number, pitch: number, regularFov?: number): CameraPose {
    const center = this.interpolatedCenter(entity, 1);
    const groundY = sampleHeight(this.hf, center.x, center.z);
    this.tmpForward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const position = new Vector3(center.x, groundY + 1.72, center.z).addScaledVector(this.tmpForward, 0.2);
    this.tmpAimTarget.copy(position).addScaledVector(this.tmpForward, 230);
    const fov = regularFov ?? MathUtils.lerp(SNIPER_SCOPE_FOV_WIDE, SNIPER_SCOPE_FOV_TIGHT, this.sniperScopeZoom);
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

  private fire(slot: 'primary' | 'secondary' | 'special'): boolean {
    if (!this.possessed) return false;
    if (this.isSniper(this.possessed) && hasUnitUpgrade(this.possessed, 'combat-bike') && this.sniperBikeMoving(this.possessed)) {
      this.flashAbilityStatus('STOP COMBAT BIKE TO FIRE');
      return false;
    }
    if (this.isSniperScoped(this.possessed) && slot === 'primary') {
      const weapon = this.possessed.weapons?.primary ?? this.possessed.weapon;
      if ((weapon?.cooldown ?? 0) > 0) {
        this.sniperReloadFlash = 0.25;
        this.updateScopeOverlay(true);
        return false;
      }
      this.possessed.playerControlled!.aimYaw = this.lookYaw;
      if (this.possessed.turret) this.possessed.turret.yaw = this.lookYaw;
    }
    const target = this.possessed.flight
      ? this.flightTarget(this.possessed, slot === 'secondary' ? 'secondary' : 'primary')
      : this.isSniperScoped(this.possessed) && slot === 'primary'
        ? this.sniperScopeShotTarget(this.possessed)
        : this.isSniperScoped(this.possessed) && slot === 'special'
          ? this.sniperScopeShotTarget(this.possessed)
        : slot === 'secondary'
          ? this.bombTarget(this.possessed)
          : this.tmpAimTarget;
    const fired = manualFireAt(this.sim, this.possessed, target.x, target.z, slot, target.y);
    if (fired) this.commandSink?.fire({ id: this.possessed.id, slot, x: target.x, z: target.z, y: target.y, aimYaw: this.lookYaw });
    for (const wingman of this.squadFollowers()) {
      if (wingman.turret) wingman.turret.yaw = Math.atan2(target.x - wingman.transform.x, target.z - wingman.transform.z);
      manualFireAt(this.sim, wingman, target.x, target.z, slot, target.y);
      if (slot === 'secondary') manualFireAt(this.sim, wingman, target.x, target.z, 'primary', target.y);
    }
    if (slot === 'special') this.flashAbilityStatus(fired ? 'SPECIAL DEPLOYED' : 'ALIGN WEAPON WITH TARGET');
    return fired;
  }

  private sniperBikeMoving(entity: Entity | undefined): boolean {
    if (!entity || !this.isSniper(entity) || !hasUnitUpgrade(entity, 'combat-bike')) return false;
    return Math.hypot(entity.velocity?.x ?? 0, entity.velocity?.z ?? 0) > 0.55;
  }

  private flashAbilityStatus(message: string): void {
    this.abilityStatus.textContent = message;
    this.abilityStatus.style.display = 'block';
    this.abilityStatusTimer = 1.35;
  }

  private updateAbilityHud(): void {
    if (this.mode !== 'fps' || !this.possessed) {
      this.abilityHud.style.display = 'none';
      return;
    }
    const weapon = this.possessed.specialWeapon;
    if (!weapon) {
      this.abilityHud.textContent = 'F  SPECIAL LOCKED';
      this.abilityHud.style.color = '#85918d';
    } else {
      const label = specialUpgradeForEntity(this.possessed)?.label ?? 'Special Weapon';
      this.abilityHud.textContent = `F  ${label.toUpperCase()}  ${weapon.cooldown > 0 ? `${weapon.cooldown.toFixed(1)}S` : 'READY'}`;
      this.abilityHud.style.color = weapon.cooldown > 0 ? '#d2b15f' : '#78df8b';
    }
    this.abilityHud.style.display = 'block';
  }

  private publishControlState(force = false): void {
    if (!this.commandSink || !this.possessed?.playerControlled) return;
    const controlled = this.possessed.playerControlled;
    const signature = [
      this.possessed.id,
      controlled.throttle.toFixed(2),
      controlled.turn.toFixed(2),
      controlled.climb?.toFixed(2) ?? '0',
      controlled.strafe?.toFixed(2) ?? '0',
      controlled.boost ? '1' : '0',
      this.lookYaw.toFixed(3),
      this.possessed.transform.x.toFixed(1),
      this.possessed.transform.z.toFixed(1),
      (this.possessed.transform.y ?? 0).toFixed(1),
    ].join(':');
    if (!force && this.sim.tick - this.lastControlSentTick < 3 && signature === this.lastControlSignature) return;
    this.lastControlSentTick = this.sim.tick;
    this.lastControlSignature = signature;
    this.commandSink.control({
      id: this.possessed.id,
      throttle: controlled.throttle,
      turn: controlled.turn,
      aimYaw: controlled.aimYaw,
      climb: controlled.climb,
      strafe: controlled.strafe,
      boost: controlled.boost,
      x: this.possessed.transform.x,
      z: this.possessed.transform.z,
      y: this.possessed.transform.y,
      rot: this.possessed.transform.rot,
      vx: this.possessed.velocity?.x,
      vz: this.possessed.velocity?.z,
    });
  }

  private flightTarget(entity: Entity, slot: 'primary' | 'secondary'): Vector3 {
    this.tmpForward.set(Math.sin(this.lookYaw) * Math.cos(this.lookPitch), Math.sin(this.lookPitch), Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
    if (slot === 'secondary') {
      return this.flightBombTarget(entity);
    }
    const ground = this.lookPitch < MathUtils.degToRad(-28) ? this.flightTerrainPoint(entity, 720) : undefined;
    if (ground) return ground;
    const origin = new Vector3(entity.transform.x, entity.transform.y ?? sampleHeight(this.hf, entity.transform.x, entity.transform.z) + 28, entity.transform.z);
    const range = 112;
    const target = origin.addScaledVector(this.tmpForward, range);
    target.y = Math.max(sampleHeight(this.hf, target.x, target.z) + 1.5, target.y);
    return target;
  }

  private flightBombTarget(entity: Entity): Vector3 {
    const ground = this.flightTerrainPoint(entity, 820) ?? this.terrainPoint(720);
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

  private updateArtilleryPreview(): void {
    const entity = this.possessed;
    const secondary = entity?.weapons?.secondary;
    if (this.mode !== 'fps' || !entity || entity.flight || secondary?.kind !== 'tankBomb') {
      this.hideArtilleryPreview();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio, 1.5);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.artilleryPreview.width !== pixelWidth || this.artilleryPreview.height !== pixelHeight) {
      this.artilleryPreview.width = pixelWidth;
      this.artilleryPreview.height = pixelHeight;
    }
    const ctx = this.artilleryPreview.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.artilleryPreview.style.display = 'block';

    const groundY = sampleHeight(this.hf, entity.transform.x, entity.transform.z);
    const from = new Vector3(entity.transform.x, groundY + 3.1, entity.transform.z);
    const to = this.bombTarget(entity);
    to.y = sampleHeight(this.hf, to.x, to.z) + 0.4;
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const control = new Vector3((from.x + to.x) / 2, Math.max(from.y, to.y) + Math.min(84, distance * 0.28), (from.z + to.z) / 2);
    const points: Array<{ x: number; y: number; visible: boolean }> = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      const point = new Vector3(from.x * a + control.x * b + to.x * c, from.y * a + control.y * b + to.y * c, from.z * a + control.z * b + to.z * c);
      point.project(this.camera);
      points.push({ x: (point.x * 0.5 + 0.5) * width, y: (-point.y * 0.5 + 0.5) * height, visible: point.z >= -1 && point.z <= 1 });
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,196,78,.82)';
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    let drawing = false;
    for (const point of points) {
      if (!point.visible) {
        drawing = false;
        continue;
      }
      if (!drawing) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
      drawing = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const landing = points[points.length - 1];
    if (landing.visible) {
      const pulse = 9 + Math.sin(performance.now() * 0.008) * 2;
      const scatterT = MathUtils.smoothstep(distance, 135, 440);
      const scatterWorld = scatterT * scatterT * 58;
      if (scatterWorld > 0.5) {
        const right = new Vector3(Math.cos(this.lookYaw) * scatterWorld, 0, -Math.sin(this.lookYaw) * scatterWorld);
        const edge = to.clone().add(right).project(this.camera);
        const radiusPx = Math.abs((edge.x * 0.5 + 0.5) * width - landing.x);
        ctx.strokeStyle = 'rgba(255,170,65,.38)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(landing.x, landing.y, Math.max(12, radiusPx), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = 'rgba(255,92,62,.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(landing.x, landing.y, pulse, 0, Math.PI * 2);
      ctx.moveTo(landing.x - pulse - 5, landing.y);
      ctx.lineTo(landing.x + pulse + 5, landing.y);
      ctx.moveTo(landing.x, landing.y - pulse - 5);
      ctx.lineTo(landing.x, landing.y + pulse + 5);
      ctx.stroke();
    }
  }

  private hideArtilleryPreview(): void {
    if (this.artilleryPreview.style.display === 'none') return;
    this.artilleryPreview.style.display = 'none';
    this.artilleryPreview.getContext('2d')?.clearRect(0, 0, this.artilleryPreview.width, this.artilleryPreview.height);
  }

  private sniperScopeShotTarget(entity: Entity): Vector3 {
    const dir = new Vector3();
    this.camera.getWorldDirection(dir);
    const horizontal = Math.max(0.001, Math.hypot(dir.x, dir.z));
    const range = entity.weapon?.range ?? 320;
    const muzzleY = sampleHeight(this.hf, entity.transform.x, entity.transform.z) + 1.72;
    return new Vector3(
      entity.transform.x + (dir.x / horizontal) * range,
      muzzleY + (dir.y / horizontal) * range,
      entity.transform.z + (dir.z / horizontal) * range,
    );
  }

  /*
   * Kept for later shell-drop/ground targeting. Manual cannon fire currently uses the turret
   * aim vector so the shot does not snap down to the near ground in chase camera.
   */
  private terrainPoint(maxDistance = 260): Vector3 | undefined {
    const origin = this.camera.position;
    const dir = new Vector3();
    this.camera.getWorldDirection(dir);
    return this.rayTerrainPoint(origin, dir, maxDistance);
  }

  private flightTerrainPoint(entity: Entity, maxDistance: number): Vector3 | undefined {
    const y = entity.transform.y ?? sampleHeight(this.hf, entity.transform.x, entity.transform.z) + 28;
    const origin = new Vector3(entity.transform.x, y, entity.transform.z);
    const dir = new Vector3(
      Math.sin(this.lookYaw) * Math.cos(this.lookPitch),
      Math.sin(this.lookPitch),
      Math.cos(this.lookYaw) * Math.cos(this.lookPitch),
    );
    return this.rayTerrainPoint(origin, dir, maxDistance);
  }

  private rayTerrainPoint(origin: Vector3, dir: Vector3, maxDistance: number): Vector3 | undefined {
    let lo = 0;
    let hi = maxDistance;
    let hit = false;
    const p = new Vector3();
    const step = maxDistance / 96;
    for (let i = 1; i <= 96; i++) {
      const t = step * i;
      p.copy(origin).addScaledVector(dir, t);
      if (p.y <= sampleHeight(this.hf, p.x, p.z) + 0.4) {
        hi = t;
        lo = Math.max(0, t - step);
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
    const center = this.interpolatedCenter(entity, 1);
    const groundY = sampleHeight(this.hf, center.x, center.z);
    const targetY = entity.flight ? center.y : groundY + 1.6;
    const target = new Vector3(center.x, targetY, center.z);
    const currentPosition = this.camera.position.clone();
    const away = currentPosition.clone().sub(target);
    if (away.lengthSq() < 0.001) away.set(-Math.sin(this.lookYaw), 0.5, -Math.cos(this.lookYaw));
    away.normalize();
    const horizontal = new Vector3(away.x, 0, away.z);
    if (horizontal.lengthSq() < 0.001) horizontal.set(-Math.sin(this.lookYaw), 0, -Math.cos(this.lookYaw));
    horizontal.normalize();
    const distance = entity.flight ? 78 : 64;
    const height = entity.flight ? 46 : 40;
    const position = target.clone().addScaledVector(horizontal, distance);
    position.y = Math.max(target.y + 18, groundY + height);
    return this.lookPose(position, target, 50);
  }

  private zoomScale(): number {
    return Math.exp(this.chaseZoom * 0.55);
  }

  private zoomedFov(baseFov: number): number {
    return MathUtils.clamp(baseFov + this.chaseZoom * 3.2, 48, 76);
  }

  private takeControl(entity: Entity): void {
    if (this.possessed && this.possessed !== entity) {
      delete this.possessed.playerControlled;
      this.commandSink?.release(this.possessed.id);
    }
    this.possessed = entity;
    this.lookYaw = nearestEquivalentAngle(entity.transform.rot, this.lookYaw);
    this.lookPitch = entity.flight ? MathUtils.degToRad(-7) : MathUtils.degToRad(-3);
    this.sniperScopeZoom = 0.35;
    this.sniperScopeActive = false;
    entity.playerControlled = { throttle: 0, turn: 0, aimYaw: this.lookYaw, climb: 0, strafe: 0, boost: false };
    this.lastControlSentTick = -999;
    this.lastControlSignature = '';
    this.publishControlState(true);
  }

  private ensurePointerLock(): void {
    if (document.pointerLockElement === this.dom) return;
    void this.dom.requestPointerLock?.();
  }

  private isSniper(entity: Entity | undefined): boolean {
    return entity?.weapon?.kind === 'sniperRifle';
  }

  private isSniperScoped(entity = this.possessed): boolean {
    return this.mode === 'fps' && this.isSniper(entity) && this.sniperScopeActive;
  }

  private updateScopeOverlay(visible: boolean): void {
    this.scopeOverlay.style.display = visible ? 'block' : 'none';
    this.scopeStatus.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const opacity = MathUtils.lerp(0.74, 0.9, this.sniperScopeZoom);
    this.scopeOverlay.style.opacity = opacity.toFixed(3);
    const weapon = this.possessed?.weapons?.primary ?? this.possessed?.weapon;
    const cooldown = weapon?.kind === 'sniperRifle' ? weapon.cooldown : 0;
    if (cooldown > 0) {
      this.scopeStatus.textContent = this.sniperReloadFlash > 0 ? 'RELOADING' : `${cooldown.toFixed(1)}s`;
      this.scopeStatus.style.color = this.sniperReloadFlash > 0 ? 'rgba(255,198,106,.95)' : 'rgba(216,255,208,.72)';
    } else {
      this.scopeStatus.textContent = 'READY';
      this.scopeStatus.style.color = 'rgba(216,255,208,.9)';
    }
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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function nearestEquivalentAngle(angle: number, near: number): number {
  const turn = Math.PI * 2;
  return angle + Math.round((near - angle) / turn) * turn;
}
