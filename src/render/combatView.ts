import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { CombatEvent } from '../sim/world';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';

interface Tracer {
  line: Line;
  ttl: number;
  total: number;
}

interface Burst {
  group: Group;
  ttl: number;
  total: number;
  kind: 'small' | 'bomb' | 'ripple';
  materials: MeshBasicMaterial[];
  baseScale: number;
}

interface BombProjectile {
  group: Group;
  trail: Line;
  trailPositions: Vector3[];
  from: Vector3;
  control: Vector3;
  to: Vector3;
  elapsed: number;
  duration: number;
  launchDelay: number;
  event: CombatEvent;
  smokeTimer: number;
  direction?: Vector3;
  trailCapacity: number;
  healthBar?: StrategicHealthBar;
}

interface StrategicWreck {
  group: Group;
  velocity: Vector3;
  spin: Vector3;
  smokeTimer: number;
  ttl: number;
  weaponKind: 'strategicMissile' | 'emberDrone';
}

interface StrategicHealthBar {
  group: Group;
  fill: Sprite;
  fillMaterial: SpriteMaterial;
  width: number;
  health: number;
  maxHealth: number;
}

interface HitIndicator {
  sprite: Sprite;
  material: SpriteMaterial;
  texture: CanvasTexture;
  ttl: number;
  total: number;
  rise: number;
}

interface SmokePuff {
  mesh: Mesh | Sprite;
  material: MeshBasicMaterial | SpriteMaterial;
  velocity: Vector3;
  ttl: number;
  total: number;
  spin: number;
  baseScale?: Vector3;
  growth?: number;
  delay?: number;
  fadeIn?: number;
  fadePower?: number;
}

interface HitFragment {
  mesh: Mesh;
  material: MeshBasicMaterial;
  velocity: Vector3;
  ttl: number;
  total: number;
  spin: Vector3;
}

interface GroundScorch {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  texture: CanvasTexture;
  material: MeshBasicMaterial;
  ttl: number;
  total: number;
  baseOpacity: number;
}

type VisualQualityTier = 0 | 1 | 2;

interface IndexedCombatEvent {
  event: CombatEvent;
  index: number;
}

const COMBAT_EVENT_BUDGETS = [
  { total: 48, critical: 12, local: 24 },
  { total: 34, critical: 10, local: 17 },
  { total: 22, critical: 8, local: 10 },
] as const;

/**
 * Keep a simultaneous multi-army firefight from allocating hundreds of GPU
 * resources in one simulation tick. Gameplay still processes every event;
 * this only samples the cosmetic representation and favours destruction plus
 * the local commander's fire.
 */
export function selectCombatVisualEvents(
  events: CombatEvent[],
  localTeam: number,
  quality: VisualQualityTier,
  totalLimit: number = COMBAT_EVENT_BUDGETS[quality].total,
): CombatEvent[] {
  const visualEvents = events.filter(
    (event) => event.kind !== 'ore-delivery'
      && event.kind !== 'impact-reaction'
      && event.kind !== 'strategic-missile-warning'
      && event.kind !== 'ember-drone-lock'
      && event.kind !== 'ember-drone-resume',
  );
  const budget = COMBAT_EVENT_BUDGETS[quality];
  const total = Math.min(budget.total, Math.max(0, Math.floor(totalLimit)));
  if (total === 0) return [];
  if (visualEvents.length <= total) return visualEvents;

  const indexed = visualEvents.map((event, index) => ({ event, index }));
  const critical = indexed.filter(({ event }) => isCriticalVisualEvent(event));
  const local = indexed.filter(({ event }) => !isCriticalVisualEvent(event) && event.sourceTeamId === localTeam);
  const remote = indexed.filter(({ event }) => !isCriticalVisualEvent(event) && event.sourceTeamId !== localTeam);
  const selected = new Set<number>();

  const criticalReservation = Math.min(budget.critical, Math.ceil((total * budget.critical) / budget.total));
  const localReservation = Math.min(budget.local, Math.ceil((total * budget.local) / budget.total));
  addSpreadSelection(selected, critical, Math.min(criticalReservation, total));
  addSpreadSelection(selected, local, Math.min(localReservation, total - selected.size));
  addSpreadSelection(selected, remote, total - selected.size);

  // A bucket can be smaller than its reservation. Fill any unused capacity
  // from the complete stream, still spread across the whole battlefield.
  if (selected.size < total) {
    addSpreadSelection(selected, indexed.filter(({ index }) => !selected.has(index)), total - selected.size);
  }

  return indexed
    .filter(({ index }) => selected.has(index))
    .sort((a, b) => a.index - b.index)
    .map(({ event }) => event);
}

function isCriticalVisualEvent(event: CombatEvent): boolean {
  return event.killed || event.strategicId !== undefined || event.weaponKind === 'strategicMissile' || event.kind === 'crash' || event.kind === 'aircraft-crash-smoke';
}

function addSpreadSelection(selected: Set<number>, candidates: IndexedCombatEvent[], count: number): void {
  const take = Math.min(Math.max(0, count), candidates.length);
  if (take === 0) return;
  if (take === candidates.length) {
    for (const candidate of candidates) selected.add(candidate.index);
    return;
  }
  for (let i = 0; i < take; i++) {
    const candidateIndex = Math.min(candidates.length - 1, Math.floor(((i + 0.5) * candidates.length) / take));
    selected.add(candidates[candidateIndex].index);
  }
}

export class CombatView {
  readonly group = new Group();
  private readonly cannonMaterial = new LineBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.92 });
  private readonly rifleMaterial = new LineBasicMaterial({ color: 0xff8f62, transparent: true, opacity: 0.8 });
  private readonly autocannonMaterial = new LineBasicMaterial({ color: 0xffc14f, transparent: true, opacity: 0.9 });
  private readonly aviationCannonMaterial = new LineBasicMaterial({ color: 0x77dfff, transparent: true, opacity: 0.88 });
  private readonly sniperMaterial = new LineBasicMaterial({ color: 0xd8ffd0, transparent: true, opacity: 0.96 });
  private readonly microLaserMaterial = new LineBasicMaterial({ color: 0x67f4ff, transparent: true, opacity: 0.94 });
  private readonly skylanceMaterial = new LineBasicMaterial({ color: 0xf4fff7, transparent: true, opacity: 0.98 });
  private readonly tracers: Tracer[] = [];
  private readonly bursts: Burst[] = [];
  private readonly bombProjectiles: BombProjectile[] = [];
  private readonly strategicWrecks: StrategicWreck[] = [];
  private readonly hitIndicators: HitIndicator[] = [];
  private readonly smokePuffs: SmokePuff[] = [];
  private softSmokeTexture?: CanvasTexture;
  private readonly hitFragments: HitFragment[] = [];
  private readonly groundScorches: GroundScorch[] = [];
  private readonly up = new Vector3(0, 1, 0);
  private visualQuality: VisualQualityTier = 0;
  private visualEventsThisFrame = 0;

  constructor(
    private readonly hf: Heightfield,
    private readonly isVisible: (x: number, z: number) => boolean = () => true,
    private readonly resolveEntity: (id: number) => Entity | undefined = () => undefined,
    private readonly localTeam = 1,
  ) {}

  setVisualQuality(tier: VisualQualityTier): void {
    this.visualQuality = tier;
  }

  /** Called once after a browser frame so catch-up ticks share one FX budget. */
  completeFrame(): void {
    this.visualEventsThisFrame = 0;
  }

  push(events: CombatEvent[]): void {
    for (const event of events) {
      if (event.strategicId !== undefined && event.targetHealth !== undefined && event.targetMaxHealth !== undefined) {
        this.updateStrategicHealth(event.strategicId, event.targetHealth, event.targetMaxHealth);
      }
      if (event.kind === 'ember-drone-lock') this.retargetEmberProjectile(event);
      if (event.kind === 'ember-drone-resume') this.resumeEmberProjectile(event);
      if (event.kind === 'strategic-missile-intercepted') this.crashStrategicProjectile(event.strategicId);
    }
    const frameBudget = this.visualQuality === 0 ? 72 : this.visualQuality === 1 ? 48 : 30;
    const remaining = frameBudget - this.visualEventsThisFrame;
    if (remaining <= 0) return;
    const selectedEvents = selectCombatVisualEvents(events, this.localTeam, this.visualQuality, remaining);
    this.visualEventsThisFrame += selectedEvents.length;
    for (const event of selectedEvents) {
      const sourceVisible = this.isVisible(event.fromX, event.fromZ);
      const impactVisible = this.isVisible(event.toX, event.toZ);
      const playerHiddenHit = event.sourceTeamId === this.localTeam && event.damage > 0;
      // fights entirely inside the fog stay hidden, except brief player-fired hit confirmations
      if (!sourceVisible && !impactVisible && !playerHiddenHit) continue;
      if (event.kind === 'strategic-missile-intercepted') {
        this.crashStrategicProjectile(event.strategicId);
        this.spawnBombBlast(event.toX, event.toY ?? sampleHeight(this.hf, event.toX, event.toZ) + 1.2, event.toZ, true, 1.45);
        this.spawnHitFragments(event, event.toY ?? sampleHeight(this.hf, event.toX, event.toZ) + 1.2);
        continue;
      }
      const muzzleHeight = isBombKind(event.kind) ? 3.1 : event.kind === 'sniperRifle' ? 1.72 : event.kind === 'rifle' ? 1.35 : event.kind === 'microLaser' ? 2.75 : 2.2;
      const fromY = event.fromY ?? sampleHeight(this.hf, event.fromX, event.fromZ) + muzzleHeight;
      const waterHit = isWaterSurfaceHit(this.hf, event.toX, event.toZ, event.toY);
      const toY = event.toY ?? (waterHit ? this.hf.waterLevel + 0.08 : sampleHeight(this.hf, event.toX, event.toZ) + 1.4);
      if (event.kind === 'aircraft-crash-smoke') {
        this.spawnAircraftCrashSmoke(event, toY);
        continue;
      }
      if (event.kind === 'crash') {
        this.spawnCrashBlast(event.toX, sampleHeight(this.hf, event.toX, event.toZ) + 0.6, event.toZ);
        continue;
      }
      if (isProjectileLaunch(event.kind)) {
        this.spawnBombProjectile(event, fromY, toY);
        continue;
      }
      if (isProjectileImpact(event.kind)) {
        this.removeImpactedHomingProjectile(event);
        if (waterHit) this.spawnWaterRipple(event.toX, event.toZ, waterRippleScale(event.kind, event.weaponKind));
        else if (shouldPaintGroundScorch(this.hf, event)) this.spawnGroundScorch(event);
        const impactY = event.targetType === 'aircraft'
          ? toY
          : waterHit
            ? this.hf.waterLevel + 0.08
            : sampleHeight(this.hf, event.toX, event.toZ) + 0.4;
        if (event.weaponKind === 'strategicMissile') {
          this.spawnStrategicBlast(event, impactY);
        } else if (isBombImpact(event.kind) || event.kind === 'grenade-impact' || event.kind === 'artilleryShell-impact' || event.kind === 'agMissile-impact' || isTankMissileImpact(event.kind)) {
          this.spawnBombBlast(
            event.toX,
            impactY,
            event.toZ,
            event.killed,
            impactBlastScale(event.kind, event.weaponKind) * (event.impactScale ?? 1),
          );
        } else if (!waterHit) {
          this.spawnSmallImpact(event.toX, toY, event.toZ, event.killed, (event.impactScale ?? 1) * smallImpactScale(event.weaponKind ?? event.kind));
        }
        if (event.damage > 0 || event.killed) {
          this.spawnHitIndicator(event);
          if (!waterHit) this.spawnHitFragments(event, toY);
        }
        if (!waterHit) this.spawnImpactAftermathSmoke(event, impactY);
        continue;
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([event.fromX, fromY, event.fromZ, event.toX, toY, event.toZ], 3));
      const line = new Line(
        geometry,
        event.kind === 'skylanceGun'
          ? this.skylanceMaterial
          : event.kind === 'microLaser'
          ? this.microLaserMaterial
          : event.kind === 'waspAutocannon'
            ? this.aviationCannonMaterial
          : event.kind === 'autocannon'
            ? this.autocannonMaterial
          : event.kind === 'sniperRifle' || event.kind === 'railShot'
            ? this.sniperMaterial
            : event.kind === 'rifle' || event.kind === 'overchargeRifle'
              ? this.rifleMaterial
              : this.cannonMaterial,
      );
      line.renderOrder = 50;
      const tracerTtl = event.kind === 'sniperRifle' || event.kind === 'railShot' ? 0.34
        : event.kind === 'skylanceGun' ? 0.1
        : event.kind === 'microLaser' ? 0.11
          : event.kind === 'waspAutocannon' ? 0.055
            : event.kind === 'autocannon' ? 0.075
              : event.kind === 'rifle' || event.kind === 'overchargeRifle' ? 0.08 : 0.16;
      this.tracers.push({ line, ttl: tracerTtl, total: tracerTtl });
      this.group.add(line);
      if (event.kind === 'sniperRifle' || event.kind === 'railShot') {
        this.spawnSniperShotFeedback(event, fromY, toY);
      }
      this.trimTracers();

      if (waterHit) this.spawnWaterRipple(event.toX, event.toZ, waterRippleScale(event.kind, event.weaponKind));
      else this.spawnSmallImpact(event.toX, toY, event.toZ, event.killed, (event.impactScale ?? 1) * smallImpactScale(event.weaponKind ?? event.kind));
      if (!waterHit && event.killed && event.targetType === 'tank') {
        this.spawnImpactAftermathSmoke(event, sampleHeight(this.hf, event.toX, event.toZ) + 0.55);
      }
      if (event.kind !== 'microLaser' && (event.damage > 0 || event.killed)) {
        this.spawnHitIndicator(event);
        if (!waterHit) this.spawnHitFragments(event, toY);
      }
    }
  }

  update(dt: number): void {
    this.updateBombProjectiles(dt);
    this.updateStrategicWrecks(dt);
    this.updateSmokePuffs(dt);
    this.updateHitFragments(dt);
    this.updateGroundScorches(dt);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.ttl -= dt;
      const material = tracer.line.material as LineBasicMaterial;
      material.opacity = Math.max(0, tracer.ttl / tracer.total);
      if (tracer.ttl <= 0) {
        this.disposeTracer(tracer);
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.ttl -= dt;
      const life = Math.max(0, burst.ttl / burst.total);
      const age = 1 - life;
      if (burst.kind === 'bomb') {
        burst.group.scale.setScalar(burst.baseScale * (1 + age * 1.28));
        for (const material of burst.materials) {
          if (material.userData.role === 'smoke') material.opacity = Math.min(0.2, age * 0.36) * life;
          else if (material.userData.role === 'shock') material.opacity = life * 0.2;
          else if (material.userData.role === 'scorch') material.opacity = life * 0.14;
          else if (material.userData.role === 'debris') material.opacity = life * 0.42;
          else material.opacity = life * 0.54;
        }
      } else if (burst.kind === 'ripple') {
        burst.group.scale.setScalar(burst.baseScale * (0.55 + age * 2.6));
        for (const material of burst.materials) {
          material.opacity = life * (material.userData.baseOpacity ?? 0.48);
        }
      } else {
        burst.group.scale.multiplyScalar(1 + dt * 2.2);
        for (const material of burst.materials) material.opacity = life * 0.72;
      }
      if (burst.ttl <= 0) {
        this.disposeBurst(burst);
        this.bursts.splice(i, 1);
      }
    }
    for (let i = this.hitIndicators.length - 1; i >= 0; i--) {
      const indicator = this.hitIndicators[i];
      indicator.ttl -= dt;
      const life = Math.max(0, indicator.ttl / indicator.total);
      const age = 1 - life;
      indicator.sprite.position.y += indicator.rise * dt;
      indicator.sprite.scale.setScalar(1 + Math.sin(Math.min(1, age * 3.5) * Math.PI) * 0.12);
      indicator.material.opacity = Math.min(1, life * 1.6);
      if (indicator.ttl <= 0) {
        this.group.remove(indicator.sprite);
        indicator.texture.dispose();
        indicator.material.dispose();
        this.hitIndicators.splice(i, 1);
      }
    }
  }

  private trimTracers(): void {
    const maxTracers = this.visualQuality === 0 ? 96 : this.visualQuality === 1 ? 64 : 40;
    while (this.tracers.length > maxTracers) this.disposeTracer(this.tracers.shift());
  }

  private spawnSniperShotFeedback(event: CombatEvent, fromY: number, toY: number): void {
    const dx = event.toX - event.fromX;
    const dz = event.toZ - event.fromZ;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const offsetX = (-dz / length) * 0.085;
    const offsetZ = (dx / length) * 0.085;
    for (const side of [-1, 1]) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        event.fromX + offsetX * side, fromY, event.fromZ + offsetZ * side,
        event.toX + offsetX * side, toY, event.toZ + offsetZ * side,
      ], 3));
      const echo = new Line(geometry, this.sniperMaterial);
      echo.renderOrder = 51;
      this.tracers.push({ line: echo, ttl: 0.22, total: 0.22 });
      this.group.add(echo);
    }

    const flashMaterial = new MeshBasicMaterial({
      color: 0xe7ffd9,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
    });
    const flash = new Mesh(new SphereGeometry(0.46, 10, 6), flashMaterial);
    const group = new Group();
    group.add(flash);
    group.position.set(event.fromX, fromY, event.fromZ);
    group.renderOrder = 54;
    this.group.add(group);
    this.bursts.push({ group, ttl: 0.16, total: 0.16, kind: 'small', materials: [flashMaterial], baseScale: 1 });
    this.trimBursts();
  }

  private disposeTracer(tracer?: Tracer): void {
    if (!tracer) return;
    this.group.remove(tracer.line);
    tracer.line.geometry.dispose();
  }

  private spawnBombProjectile(event: CombatEvent, fromY: number, toY: number): void {
    const from = new Vector3(event.fromX, fromY, event.fromZ);
    const to = new Vector3(event.toX, toY, event.toZ);
    const distance = Math.hypot(event.toX - event.fromX, event.toZ - event.fromZ);
    const drop = event.trajectory === 'drop';
    const flat = event.trajectory === 'flat' || event.trajectory === 'homing';
    const strategic = event.strategicId !== undefined;
    const ember = event.weaponKind === 'emberDrone';
    const strategicLift = event.strategicLift;
    const controlY = drop
      ? Math.max(toY + 2, (fromY + toY) * 0.46 - Math.min(16, distance * 0.04))
      : ember
        ? (fromY + toY) * 0.5 + 2 * (strategicLift ?? 5)
      : flat
        ? (fromY + toY) * 0.5
        : strategic
          // Match the simulation's capped strategic arc so interceptor trails
          // visibly meet the missile instead of flying below cosmetic altitude.
          ? (fromY + toY) * 0.5 + 2 * (strategicLift ?? Math.min(28, distance * 0.32))
          : Math.max(fromY, toY) + Math.min(190, distance * 0.24);
    const control = new Vector3((event.fromX + event.toX) / 2, controlY, (event.fromZ + event.toZ) / 2);
    const group = this.makeProjectileMesh(event);
    group.position.copy(from);
    group.renderOrder = 60;
    this.group.add(group);

    const homing = event.trajectory === 'homing';
    const trailCapacity = event.weaponKind === 'strategicMissile' ? 72 : ember ? 30 : homing ? 20 : 8;
    const trailGeometry = new BufferGeometry();
    trailGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(trailCapacity * 3), 3));
    const trail = new Line(trailGeometry, new LineBasicMaterial({
      color: trailColor(event.weaponKind ?? event.kind),
      transparent: true,
      opacity: homing ? 0.88 : 0.5,
      depthWrite: false,
    }));
    trail.renderOrder = 58;
    this.group.add(trail);

    const launchDelay = Math.max(0, event.launchDelay ?? 0);
    group.visible = launchDelay <= 0;
    trail.visible = launchDelay <= 0;
    this.bombProjectiles.push({
      group,
      trail,
      trailPositions: [from.clone()],
      from,
      control,
      to,
      elapsed: 0,
      // matches the sim's flight time exactly — the blast lands when the damage does
      duration: event.duration ?? Math.min(8, Math.max(0.85, distance / 95)),
      launchDelay,
      event,
      smokeTimer: 0,
      direction: homing ? to.clone().sub(from).normalize() : undefined,
      trailCapacity,
      healthBar: strategic && event.strategicId !== undefined
        ? this.makeStrategicHealthBar(event.targetHealth ?? 100, event.targetMaxHealth ?? 100)
        : undefined,
    });
    const spawned = this.bombProjectiles[this.bombProjectiles.length - 1];
    if (spawned.healthBar) spawned.healthBar.group.visible = launchDelay <= 0;
    if (spawned.healthBar) this.syncStrategicHealthBar(spawned);
    const maxProjectiles = this.visualQuality === 0 ? 72 : this.visualQuality === 1 ? 48 : 28;
    while (this.bombProjectiles.length > maxProjectiles) this.disposeBombProjectile(this.bombProjectiles.shift());
  }

  private updateBombProjectiles(dt: number): void {
    for (let i = this.bombProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.bombProjectiles[i];
      if (projectile.launchDelay > 0) {
        projectile.launchDelay = Math.max(0, projectile.launchDelay - dt);
        if (projectile.launchDelay <= 0) {
          projectile.group.visible = true;
          projectile.trail.visible = true;
          if (projectile.healthBar) projectile.healthBar.group.visible = true;
        }
        continue;
      }
      projectile.elapsed += dt;
      if (
        projectile.event.trajectory === 'homing' &&
        projectile.event.targetId !== undefined &&
        projectile.direction &&
        projectile.event.homingSpeed !== undefined &&
        projectile.event.homingTurnRate !== undefined
      ) {
        const target = this.resolveEntity(projectile.event.targetId);
        if (target && !target.destroyed) {
          const targetY = target.flight
            ? target.transform.y ?? projectile.to.y
            : sampleHeight(this.hf, target.transform.x, target.transform.z)
              + (target.building ? 2.8 : target.selectable?.type === 'infantry' ? 1.15 : 1.7);
          projectile.to.set(target.transform.x, targetY, target.transform.z);
          const desired = projectile.to.clone().sub(projectile.group.position).normalize();
          const delta = desired.sub(projectile.direction);
          const maxDirectionDelta = projectile.event.homingTurnRate * dt;
          const blend = delta.length() > maxDirectionDelta ? maxDirectionDelta / delta.length() : 1;
          projectile.direction.addScaledVector(delta, blend).normalize();
        }
        projectile.group.position.addScaledVector(projectile.direction, projectile.event.homingSpeed * dt);
        if (target?.flight) {
          const terrainY = sampleHeight(this.hf, projectile.group.position.x, projectile.group.position.z);
          if (projectile.group.position.y <= terrainY + 0.35) {
            projectile.group.position.y = terrainY + 0.65;
            projectile.direction.y = Math.max(0.04, projectile.direction.y);
            projectile.direction.normalize();
          }
        }
        projectile.group.quaternion.copy(new Quaternion().setFromUnitVectors(this.up, projectile.direction));
        this.syncStrategicHealthBar(projectile);
        projectile.trailPositions.push(projectile.group.position.clone());
        if (projectile.trailPositions.length > projectile.trailCapacity) projectile.trailPositions.shift();
        this.updateTrail(projectile);
        this.emitProjectileSmoke(projectile, projectile.direction, dt);
        if (projectile.elapsed >= projectile.duration) {
          this.disposeBombProjectile(projectile);
          this.bombProjectiles.splice(i, 1);
        }
        continue;
      }
      const t = Math.min(1, projectile.elapsed / projectile.duration);
      const position = bezier(projectile.from, projectile.control, projectile.to, t);
      const tangent = bezierTangent(projectile.from, projectile.control, projectile.to, t).normalize();
      projectile.group.position.copy(position);
      projectile.group.quaternion.copy(new Quaternion().setFromUnitVectors(this.up, tangent));
      this.syncStrategicHealthBar(projectile);
      projectile.trailPositions.push(position.clone());
      if (projectile.trailPositions.length > projectile.trailCapacity) projectile.trailPositions.shift();
      this.updateTrail(projectile);
      this.emitProjectileSmoke(projectile, tangent, dt);
      if (t >= 1) {
        this.disposeBombProjectile(projectile);
        // the blast is driven by the sim's 'bomb-impact' event, not the visual flight
        this.bombProjectiles.splice(i, 1);
      }
    }
  }

  private removeImpactedHomingProjectile(event: CombatEvent): void {
    const launchKind = event.kind.slice(0, -'-impact'.length);
    for (let i = this.bombProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.bombProjectiles[i];
      if (projectile.event.trajectory !== 'homing' || projectile.event.kind !== launchKind) continue;
      if (
        event.targetId !== undefined &&
        projectile.event.targetId !== undefined &&
        event.targetId !== projectile.event.targetId
      ) continue;
      this.disposeBombProjectile(projectile);
      this.bombProjectiles.splice(i, 1);
      return;
    }
  }

  private retargetEmberProjectile(event: CombatEvent): void {
    if (event.strategicId === undefined || event.targetId === undefined) return;
    const projectile = this.bombProjectiles.find((candidate) => candidate.event.strategicId === event.strategicId);
    if (!projectile) return;
    const progress = Math.min(1, projectile.elapsed / Math.max(0.001, projectile.duration));
    const currentDirection = projectile.direction?.clone()
      ?? bezierTangent(projectile.from, projectile.control, projectile.to, progress).normalize();
    const launchKind = projectile.event.kind;
    projectile.event = { ...projectile.event, ...event, kind: launchKind };
    projectile.to.set(event.toX, event.toY ?? projectile.to.y, event.toZ);
    projectile.elapsed = 0;
    projectile.duration = event.duration ?? 6;
    projectile.direction = currentDirection.lengthSq() > 0.0001
      ? currentDirection.normalize()
      : projectile.to.clone().sub(projectile.group.position).normalize();
  }

  private resumeEmberProjectile(event: CombatEvent): void {
    if (event.strategicId === undefined) return;
    const projectile = this.bombProjectiles.find((candidate) => candidate.event.strategicId === event.strategicId);
    if (!projectile) return;
    const launchKind = projectile.event.kind;
    projectile.event = { ...projectile.event, ...event, kind: launchKind, targetId: undefined };
    projectile.from.copy(projectile.group.position);
    projectile.to.set(event.toX, event.toY ?? projectile.to.y, event.toZ);
    const lift = event.strategicLift ?? 5;
    projectile.control.set(
      (projectile.from.x + projectile.to.x) * 0.5,
      (projectile.from.y + projectile.to.y) * 0.5 + lift * 2,
      (projectile.from.z + projectile.to.z) * 0.5,
    );
    projectile.elapsed = 0;
    projectile.duration = event.duration ?? 3;
    projectile.direction = undefined;
  }

  private crashStrategicProjectile(strategicId: number | undefined): void {
    if (strategicId === undefined) return;
    for (let i = this.bombProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.bombProjectiles[i];
      if (projectile.event.strategicId !== strategicId) continue;
      this.bombProjectiles.splice(i, 1);
      this.group.remove(projectile.trail);
      projectile.trail.geometry.dispose();
      (projectile.trail.material as LineBasicMaterial).dispose();
      if (projectile.healthBar) {
        this.group.remove(projectile.healthBar.group);
        projectile.healthBar.group.traverse((object) => {
          if (object instanceof Sprite) object.material.dispose();
        });
      }

      let part = 0;
      projectile.group.name = 'destroyed-strategic-wreck';
      projectile.group.traverse((object) => {
        if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
        object.material.color.multiplyScalar(0.22);
        if (object.material.transparent) object.material.opacity = Math.min(object.material.opacity, 0.12);
        if (part > 0) {
          object.position.x += Math.sin(strategicId * 0.17 + part * 2.1) * 0.16;
          object.position.z += Math.cos(strategicId * 0.13 + part * 1.7) * 0.13;
          object.rotation.x += Math.sin(part * 1.9) * 0.22;
          object.rotation.z += Math.cos(part * 1.4) * 0.28;
        }
        part++;
      });
      const forward = new Vector3(0, 1, 0).applyQuaternion(projectile.group.quaternion).normalize();
      const missile = projectile.event.weaponKind === 'strategicMissile';
      this.strategicWrecks.push({
        group: projectile.group,
        velocity: forward.multiplyScalar(missile ? 13 : 9).setY(-2.5),
        spin: new Vector3(missile ? 2.1 : 3.8, missile ? 1.4 : 2.9, missile ? 2.7 : 4.6),
        smokeTimer: 0,
        ttl: 8,
        weaponKind: missile ? 'strategicMissile' : 'emberDrone',
      });
      while (this.strategicWrecks.length > 18) this.disposeStrategicWreck(this.strategicWrecks.shift());
      return;
    }
  }

  private updateStrategicWrecks(dt: number): void {
    for (let i = this.strategicWrecks.length - 1; i >= 0; i--) {
      const wreck = this.strategicWrecks[i];
      wreck.ttl -= dt;
      wreck.velocity.y -= 17 * dt;
      wreck.group.position.addScaledVector(wreck.velocity, dt);
      wreck.group.rotateX(wreck.spin.x * dt);
      wreck.group.rotateY(wreck.spin.y * dt);
      wreck.group.rotateZ(wreck.spin.z * dt);
      wreck.smokeTimer -= dt;
      if (wreck.smokeTimer <= 0) {
        wreck.smokeTimer = wreck.weaponKind === 'strategicMissile' ? 0.045 : 0.075;
        this.emitStrategicWreckSmoke(wreck);
      }
      const groundY = sampleHeight(this.hf, wreck.group.position.x, wreck.group.position.z);
      if (wreck.group.position.y <= groundY + 0.45 || wreck.ttl <= 0) {
        if (wreck.group.position.y <= groundY + 0.45) {
          this.spawnCrashBlast(wreck.group.position.x, groundY + 0.55, wreck.group.position.z);
        }
        this.disposeStrategicWreck(wreck);
        this.strategicWrecks.splice(i, 1);
      }
    }
  }

  private emitStrategicWreckSmoke(wreck: StrategicWreck): void {
    this.softSmokeTexture ??= makeSoftSmokeTexture();
    const missile = wreck.weaponKind === 'strategicMissile';
    const material = new SpriteMaterial({
      map: this.softSmokeTexture,
      color: missile ? 0x343936 : 0x41423e,
      transparent: true,
      opacity: missile ? 0.66 : 0.52,
      depthWrite: false,
    });
    material.userData.baseOpacity = material.opacity;
    const puff = new Sprite(material);
    const size = missile ? 2.6 : 1.15;
    puff.scale.set(size * 1.5, size, 1);
    puff.position.copy(wreck.group.position);
    puff.renderOrder = 59;
    this.group.add(puff);
    const ttl = missile ? 2.4 : 1.65;
    this.smokePuffs.push({
      mesh: puff,
      material,
      velocity: new Vector3(-wreck.velocity.x * 0.025, 0.65, -wreck.velocity.z * 0.025),
      ttl,
      total: ttl,
      spin: 0.22,
      baseScale: puff.scale.clone(),
      growth: 2.1,
    });
    const maxSmoke = this.visualQuality === 0 ? 170 : this.visualQuality === 1 ? 104 : 62;
    while (this.smokePuffs.length > maxSmoke) this.disposeSmokePuff(this.smokePuffs.shift());
  }

  private disposeStrategicWreck(wreck?: StrategicWreck): void {
    if (!wreck) return;
    this.group.remove(wreck.group);
    wreck.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    });
  }

  private makeStrategicHealthBar(health: number, maxHealth: number): StrategicHealthBar {
    const group = new Group();
    const border = new Sprite(new SpriteMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }));
    const background = new Sprite(new SpriteMaterial({ color: 0x090d10, depthTest: false, depthWrite: false }));
    const fillMaterial = new SpriteMaterial({ color: 0x79f28b, depthTest: false, depthWrite: false });
    const fill = new Sprite(fillMaterial);
    border.scale.set(9.2, 1.45, 1);
    background.scale.set(8.65, 0.92, 1);
    fill.scale.set(8.1, 0.5, 1);
    border.renderOrder = 89;
    background.renderOrder = 90;
    fill.renderOrder = 91;
    group.add(border, background, fill);
    group.renderOrder = 89;
    this.group.add(group);
    const bar = { group, fill, fillMaterial, width: 8.1, health, maxHealth: Math.max(1, maxHealth) };
    this.layoutStrategicHealthBar(bar);
    return bar;
  }

  private updateStrategicHealth(strategicId: number, health: number, maxHealth: number): void {
    const projectile = this.bombProjectiles.find((candidate) => candidate.event.strategicId === strategicId);
    if (!projectile?.healthBar) return;
    projectile.healthBar.health = health;
    projectile.healthBar.maxHealth = Math.max(1, maxHealth);
    this.layoutStrategicHealthBar(projectile.healthBar);
  }

  private layoutStrategicHealthBar(bar: StrategicHealthBar): void {
    const ratio = Math.max(0, Math.min(1, bar.health / bar.maxHealth));
    const width = Math.max(0.001, bar.width * ratio);
    bar.fill.scale.x = width;
    bar.fill.position.x = -(bar.width - width) * 0.5;
    bar.fillMaterial.color.setHex(ratio > 0.55 ? 0x79f28b : ratio > 0.25 ? 0xffd75d : 0xff6659);
  }

  private syncStrategicHealthBar(projectile: BombProjectile): void {
    if (!projectile.healthBar) return;
    projectile.healthBar.group.position.copy(projectile.group.position);
    projectile.healthBar.group.position.y += projectile.event.weaponKind === 'strategicMissile'
      ? 7.2 + Math.max(0, (projectile.event.impactScale ?? 1) - 1) * 2.2
      : 6.8;
  }

  private disposeBombProjectile(projectile?: BombProjectile): void {
    if (!projectile) return;
    this.group.remove(projectile.group);
    projectile.group.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        if (object.material instanceof MeshBasicMaterial) object.material.dispose();
      }
    });
    this.group.remove(projectile.trail);
    projectile.trail.geometry.dispose();
    (projectile.trail.material as LineBasicMaterial).dispose();
    if (projectile.healthBar) {
      this.group.remove(projectile.healthBar.group);
      projectile.healthBar.group.traverse((object) => {
        if (object instanceof Sprite) object.material.dispose();
      });
    }
  }

  private updateTrail(projectile: BombProjectile): void {
    const attribute = projectile.trail.geometry.getAttribute('position') as Float32BufferAttribute;
    const first = projectile.trailPositions[0];
    for (let i = 0; i < projectile.trailCapacity; i++) {
      const p = projectile.trailPositions[i] ?? first;
      attribute.setXYZ(i, p.x, p.y, p.z);
    }
    attribute.needsUpdate = true;
    const material = projectile.trail.material as LineBasicMaterial;
    const maxOpacity = projectile.event.trajectory === 'homing' ? 0.88 : 0.55;
    material.opacity = Math.min(maxOpacity, projectile.elapsed / 0.18);
  }

  private emitProjectileSmoke(projectile: BombProjectile, tangent: Vector3, dt: number): void {
    projectile.smokeTimer -= dt;
    const homing = projectile.event.trajectory === 'homing';
    const visualKind = projectile.event.weaponKind ?? projectile.event.kind;
    const strategic = visualKind === 'strategicMissile';
    const warheadVisualScale = strategic
      ? 1 + Math.max(0, (projectile.event.impactScale ?? 1) - 1) * 0.24
      : 1;
    const baseCadence = projectileSmokeCadence(visualKind, projectile.event.kind, homing);
    const cadence = baseCadence * (this.visualQuality === 0 ? 1 : this.visualQuality === 1 ? 1.7 : 2.8) / warheadVisualScale;
    if (projectile.smokeTimer > 0) return;
    projectile.smokeTimer = cadence;
    const pos = projectile.group.position.clone();
    const back = tangent.clone().multiplyScalar(projectileSmokeOffset(visualKind, projectile.event.kind));
    pos.add(back);
    const phase = projectile.elapsed * 37 + projectile.event.fromX * 0.071 + projectile.event.toZ * 0.043;
    const noiseA = 0.5 + Math.sin(phase * 1.73) * 0.5;
    const noiseB = 0.5 + Math.cos(phase * 2.11 + 1.7) * 0.5;
    const lateral = new Vector3(-tangent.z, 0, tangent.x);
    if (lateral.lengthSq() < 0.001) lateral.set(1, 0, 0);
    else lateral.normalize();
    if (strategic) {
      pos.addScaledVector(lateral, (noiseA - 0.5) * 1.35 * warheadVisualScale);
      pos.y += (noiseB - 0.5) * 0.75 * warheadVisualScale;
    } else {
      pos.x += Math.sin(projectile.elapsed * 19 + projectile.event.fromX) * 0.12;
      pos.z += Math.cos(projectile.elapsed * 17 + projectile.event.fromZ) * 0.12;
    }

    if (strategic) {
      this.softSmokeTexture ??= makeSoftSmokeTexture();
      const opacity = projectileSmokeOpacity(visualKind, projectile.event.kind, homing) * (0.72 + noiseB * 0.28);
      const smokeMaterial = new SpriteMaterial({
        map: this.softSmokeTexture,
        color: noiseA > 0.66 ? 0xb6bab6 : noiseB > 0.45 ? 0x969b97 : 0x7d8480,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      smokeMaterial.userData.baseOpacity = opacity;
      smokeMaterial.rotation = (noiseA - 0.5) * 0.65;
      const puff = new Sprite(smokeMaterial);
      const size = projectileSmokeSize(visualKind, projectile.event.kind, homing) * warheadVisualScale * (0.72 + noiseA * 0.52);
      puff.scale.set(size * (1.65 + noiseB * 0.6), size * (1.24 + noiseA * 0.44), 1);
      puff.position.copy(pos);
      puff.renderOrder = 57;
      this.group.add(puff);
      const ttl = 2.65 + noiseB * 1.25;
      this.smokePuffs.push({
        mesh: puff,
        material: smokeMaterial,
        velocity: new Vector3(-tangent.x * 0.18, 0.16 + noiseA * 0.38, -tangent.z * 0.18)
          .addScaledVector(lateral, (noiseB - 0.5) * 0.62),
        ttl,
        total: ttl,
        spin: (noiseA - 0.5) * 0.48,
        baseScale: puff.scale.clone(),
        growth: 1.45 + noiseB * 1.35,
      });
      const maxSmoke = this.visualQuality === 0 ? 170 : this.visualQuality === 1 ? 104 : 62;
      while (this.smokePuffs.length > maxSmoke) this.disposeSmokePuff(this.smokePuffs.shift());
      return;
    }

    const smokeMaterial = new MeshBasicMaterial({
      color: projectileSmokeColor(visualKind, projectile.event.kind, homing),
      transparent: true,
      opacity: projectileSmokeOpacity(visualKind, projectile.event.kind, homing),
      depthWrite: false,
    });
    smokeMaterial.userData.baseOpacity = smokeMaterial.opacity;
    const puff = new Mesh(new SphereGeometry(projectileSmokeSize(visualKind, projectile.event.kind, homing), 8, 5), smokeMaterial);
    puff.position.copy(pos);
    puff.renderOrder = 57;
    this.group.add(puff);
    this.smokePuffs.push({
      mesh: puff,
      material: smokeMaterial,
      velocity: new Vector3(-tangent.x * 0.9, 0.5 + Math.abs(tangent.y) * 0.2, -tangent.z * 0.9),
      ttl: isBombKind(projectile.event.kind) ? 0.9 : homing ? 1.05 : 0.68,
      total: isBombKind(projectile.event.kind) ? 0.9 : homing ? 1.05 : 0.68,
      spin: Math.sin(projectile.elapsed * 11 + projectile.event.toX) * 0.6,
    });
    const maxSmoke = this.visualQuality === 0 ? 90 : this.visualQuality === 1 ? 58 : 36;
    while (this.smokePuffs.length > maxSmoke) this.disposeSmokePuff(this.smokePuffs.shift());
  }

  private updateSmokePuffs(dt: number): void {
    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const puff = this.smokePuffs[i];
      if ((puff.delay ?? 0) > 0) {
        puff.delay = Math.max(0, (puff.delay ?? 0) - dt);
        puff.material.opacity = 0;
        continue;
      }
      puff.ttl -= dt;
      const life = Math.max(0, puff.ttl / puff.total);
      const age = 1 - life;
      puff.mesh.position.addScaledVector(puff.velocity, dt);
      if (puff.mesh instanceof Sprite && puff.material instanceof SpriteMaterial) {
        puff.material.rotation += puff.spin * dt;
      } else {
        puff.mesh.rotation.y += puff.spin * dt;
      }
      if (puff.baseScale) {
        const growth = 1 + age * (puff.growth ?? 2.6);
        puff.mesh.scale.set(puff.baseScale.x * growth, puff.baseScale.y * growth, puff.baseScale.z);
      } else {
        puff.mesh.scale.setScalar(1 + age * 2.6);
      }
      const fadeIn = puff.fadeIn ? Math.min(1, age / puff.fadeIn) : 1;
      puff.material.opacity = (puff.material.userData.baseOpacity as number) * fadeIn * Math.pow(life, puff.fadePower ?? 2);
      if (puff.ttl <= 0) {
        this.disposeSmokePuff(puff);
        this.smokePuffs.splice(i, 1);
      }
    }
  }

  private disposeSmokePuff(puff?: SmokePuff): void {
    if (!puff) return;
    this.group.remove(puff.mesh);
    if (puff.mesh instanceof Mesh) puff.mesh.geometry.dispose();
    puff.material.dispose();
  }

  private spawnHitFragments(event: CombatEvent, y: number): void {
    const strategic = event.weaponKind === 'strategicMissile';
    const heavy = strategic || isBombImpact(event.kind);
    const fullCount = strategic ? 30 : heavy ? 18 : isTankMissileImpact(event.kind) || event.killed ? 11 : 6;
    const density = this.visualQuality === 0 ? 1 : this.visualQuality === 1 ? 0.65 : 0.38;
    const count = Math.max(2, Math.round(fullCount * density));
    const force = strategic ? 13 : heavy ? 8.5 : isTankMissileImpact(event.kind) ? 6.4 : 4.2;
    const awayX = event.toX - event.fromX;
    const awayZ = event.toZ - event.fromZ;
    const awayLength = Math.hypot(awayX, awayZ);
    const awayAngle = awayLength > 0.001 ? Math.atan2(awayZ, awayX) : 0;
    const topStrike = event.trajectory === 'drop';
    for (let i = 0; i < count; i++) {
      const seed = deterministicAngle(event.toX + i * 1.73, event.toZ - i * 0.91, event.kind);
      // Most fragments leave in a cone away from the incoming missile. A few
      // remain radial so explosions do not look mechanically identical.
      const coneOffset = (((i * 37) % count) / Math.max(1, count - 1) - 0.5) * Math.PI * 0.9;
      const angle = i % 4 === 0 ? seed + (i / count) * Math.PI * 2 : awayAngle + coneOffset;
      const spark = i % 3 === 0;
      const material = new MeshBasicMaterial({
        color: spark ? 0xffc45c : i % 2 === 0 ? 0x2c2924 : 0x696158,
        transparent: true,
        opacity: spark ? 0.94 : 0.78,
        depthWrite: false,
      });
      const size = heavy ? 0.16 + (i % 4) * 0.055 : 0.1 + (i % 3) * 0.045;
      const mesh = new Mesh(new BoxGeometry(size, spark ? size * 0.45 : size * 0.75, size * 0.55), material);
      mesh.position.set(event.toX, y + 0.25, event.toZ);
      mesh.rotation.set(angle * 0.31, angle, angle * 0.19);
      mesh.renderOrder = 59;
      this.group.add(mesh);
      const speed = force * (topStrike ? 0.46 : 0.55) * (1 + ((i * 37) % 11) / 16);
      const ttl = heavy ? 1.05 + (i % 5) * 0.06 : 0.62 + (i % 4) * 0.07;
      this.hitFragments.push({
        mesh,
        material,
        velocity: new Vector3(
          Math.cos(angle) * speed,
          force * ((topStrike ? 0.94 : 0.72) + (i % 5) * 0.1),
          Math.sin(angle) * speed,
        ),
        ttl,
        total: ttl,
        spin: new Vector3(2.5 + (i % 3), 3.2 + (i % 4), 2.1 + (i % 5)),
      });
    }
    const maxFragments = this.visualQuality === 0 ? 140 : this.visualQuality === 1 ? 88 : 52;
    while (this.hitFragments.length > maxFragments) this.disposeHitFragment(this.hitFragments.shift());
  }

  private updateHitFragments(dt: number): void {
    for (let i = this.hitFragments.length - 1; i >= 0; i--) {
      const fragment = this.hitFragments[i];
      fragment.ttl -= dt;
      fragment.velocity.y -= 18 * dt;
      fragment.mesh.position.addScaledVector(fragment.velocity, dt);
      fragment.mesh.rotation.x += fragment.spin.x * dt;
      fragment.mesh.rotation.y += fragment.spin.y * dt;
      fragment.mesh.rotation.z += fragment.spin.z * dt;
      const life = Math.max(0, fragment.ttl / fragment.total);
      fragment.material.opacity = life * life * 0.9;
      if (fragment.ttl <= 0) {
        this.disposeHitFragment(fragment);
        this.hitFragments.splice(i, 1);
      }
    }
  }

  private disposeHitFragment(fragment?: HitFragment): void {
    if (!fragment) return;
    this.group.remove(fragment.mesh);
    fragment.mesh.geometry.dispose();
    fragment.material.dispose();
  }

  private spawnGroundScorch(event: CombatEvent): void {
    const profile = scorchProfile(event.kind, event.killed, event.weaponKind);
    const texture = makeScorchTexture(event.kind, event.toX, event.toZ);
    const material = new MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity: profile.opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const impactScale = event.impactScale ?? 1;
    const mesh = new Mesh(new PlaneGeometry(profile.size * impactScale, profile.size * impactScale), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = deterministicAngle(event.toX, event.toZ, event.kind);
    mesh.position.set(event.toX, sampleHeight(this.hf, event.toX, event.toZ) + 0.045, event.toZ);
    mesh.renderOrder = 24;
    this.group.add(mesh);
    this.groundScorches.push({ mesh, texture, material, ttl: profile.ttl, total: profile.ttl, baseOpacity: profile.opacity });
    const maxScorches = this.visualQuality === 0 ? 64 : this.visualQuality === 1 ? 44 : 28;
    while (this.groundScorches.length > maxScorches) this.disposeGroundScorch(this.groundScorches.shift());
  }

  private updateGroundScorches(dt: number): void {
    for (let i = this.groundScorches.length - 1; i >= 0; i--) {
      const scorch = this.groundScorches[i];
      scorch.ttl -= dt;
      const life = Math.max(0, scorch.ttl / scorch.total);
      scorch.material.opacity = scorch.baseOpacity * Math.min(1, life * 2.2);
      scorch.mesh.scale.setScalar(1 + (1 - life) * 0.08);
      if (scorch.ttl <= 0) {
        this.disposeGroundScorch(scorch);
        this.groundScorches.splice(i, 1);
      }
    }
  }

  private disposeGroundScorch(scorch?: GroundScorch): void {
    if (!scorch) return;
    this.group.remove(scorch.mesh);
    scorch.mesh.geometry.dispose();
    scorch.texture.dispose();
    scorch.material.dispose();
  }

  private makeProjectileMesh(event: CombatEvent): Group {
    const kind = event.kind;
    const visualKind = event.weaponKind ?? kind;
    if (visualKind === 'strategicMissile') return this.makeStrategicMissileMesh(event);
    if (visualKind === 'emberDrone') return this.makeEmberDroneMesh(event);
    const profile = projectileProfile(visualKind, kind);
    const group = new Group();
    const shellMaterial = new MeshBasicMaterial({ color: profile.bodyColor });
    const noseMaterial = new MeshBasicMaterial({ color: profile.noseColor });
    const bandMaterial = new MeshBasicMaterial({ color: profile.bandColor });
    const glowMaterial = new MeshBasicMaterial({ color: profile.glowColor, transparent: true, opacity: profile.glowOpacity, depthWrite: false });
    const body = new Mesh(new CylinderGeometry(profile.tipRadius, profile.bodyRadius, profile.bodyLength, profile.segments), shellMaterial);
    const nose = new Mesh(new ConeGeometry(profile.tipRadius, profile.noseLength, profile.segments), noseMaterial);
    const band = new Mesh(new CylinderGeometry(profile.bodyRadius * 1.05, profile.bodyRadius * 1.05, profile.bandWidth, profile.segments), bandMaterial);
    const glow = new Mesh(new SphereGeometry(profile.glowRadius, 10, 6), glowMaterial);
    body.position.y = 0;
    nose.position.y = profile.bodyLength * 0.5 + profile.noseLength * 0.5;
    band.position.y = -profile.bodyLength * 0.26;
    glow.position.y = -profile.bodyLength * 0.54;
    group.add(glow, body, nose, band);
    for (let i = 0; i < profile.fins; i++) {
      const fin = new Mesh(new BoxGeometry(profile.finThickness, profile.finLength, profile.finWidth), shellMaterial.clone());
      fin.position.y = -profile.bodyLength * 0.42;
      const angle = (i / Math.max(1, profile.fins)) * Math.PI * 2;
      fin.position.x = Math.cos(angle) * profile.bodyRadius;
      fin.position.z = Math.sin(angle) * profile.bodyRadius;
      fin.rotation.y = angle;
      group.add(fin);
    }
    group.scale.setScalar(profile.scale * (event.impactScale ?? 1));
    return group;
  }

  private makeEmberDroneMesh(event: CombatEvent): Group {
    const group = new Group();
    const fuselageMaterial = new MeshBasicMaterial({ color: 0x292b28 });
    const wingMaterial = new MeshBasicMaterial({ color: 0x3d4039, side: DoubleSide });
    const darkMaterial = new MeshBasicMaterial({ color: 0x151817 });
    const accentMaterial = new MeshBasicMaterial({ color: 0xb95a2d });
    const sensorMaterial = new MeshBasicMaterial({ color: 0xff8a42 });
    const engineGlowMaterial = new MeshBasicMaterial({
      color: 0xffb15b,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });

    // The projectile's local +Y axis is its direction of travel. A broad,
    // swept planform makes Ember read as an aircraft even at RTS distance.
    const wingGeometry = new BufferGeometry();
    wingGeometry.setAttribute('position', new Float32BufferAttribute([
      -0.12, 0.58, 0, -0.2, -0.82, 0, -2.28, -0.5, 0,
      0.12, 0.58, 0, 2.28, -0.5, 0, 0.2, -0.82, 0,
    ], 3));
    const wings = new Mesh(wingGeometry, wingMaterial);
    group.add(wings);

    const body = new Mesh(new CylinderGeometry(0.27, 0.34, 1.9, 12), fuselageMaterial);
    body.position.y = -0.05;
    const nose = new Mesh(new ConeGeometry(0.27, 0.52, 12), darkMaterial);
    nose.position.y = 1.16;
    const payload = new Mesh(new BoxGeometry(0.48, 0.92, 0.3), darkMaterial.clone());
    payload.position.set(0, -0.18, -0.18);
    group.add(body, nose, payload);

    const sensor = new Mesh(new SphereGeometry(0.2, 10, 7), sensorMaterial);
    sensor.scale.set(0.82, 1, 0.64);
    sensor.position.set(0, 0.92, 0.18);
    group.add(sensor);

    // Small panels and tail surfaces break up the silhouette without turning
    // the low-cost drone into a polished fighter aircraft.
    for (const side of [-1, 1]) {
      const wingPanel = new Mesh(new BoxGeometry(0.72, 0.12, 0.035), accentMaterial.clone());
      wingPanel.position.set(side * 0.96, -0.3, 0.035);
      wingPanel.rotation.z = side * 0.14;
      group.add(wingPanel);
    }
    const tailPlane = new Mesh(new BoxGeometry(1.2, 0.38, 0.08), wingMaterial.clone());
    tailPlane.position.y = -0.94;
    const tailFin = new Mesh(new BoxGeometry(0.09, 0.5, 0.5), darkMaterial.clone());
    tailFin.position.set(0, -0.92, 0.25);
    group.add(tailPlane, tailFin);

    // Ember is propeller-driven. The compact pusher assembly and restrained
    // engine glow replace the large rocket flame used by missile meshes.
    const engine = new Mesh(new CylinderGeometry(0.2, 0.26, 0.42, 10), darkMaterial.clone());
    engine.position.y = -1.2;
    const propellerHub = new Mesh(new CylinderGeometry(0.1, 0.13, 0.18, 8), accentMaterial.clone());
    propellerHub.position.y = -1.48;
    const propellerX = new Mesh(new BoxGeometry(1.05, 0.055, 0.09), darkMaterial.clone());
    propellerX.position.y = -1.58;
    const propellerZ = new Mesh(new BoxGeometry(0.09, 0.055, 1.05), darkMaterial.clone());
    propellerZ.position.y = -1.58;
    const engineGlow = new Mesh(new SphereGeometry(0.19, 9, 6), engineGlowMaterial);
    engineGlow.position.y = -1.53;
    group.add(engine, propellerHub, propellerX, propellerZ, engineGlow);

    const warheadScale = 1 + Math.max(0, (event.impactScale ?? 0.95) - 0.95) * 0.18;
    group.scale.setScalar(1.35 * warheadScale);
    return group;
  }

  private makeStrategicMissileMesh(event: CombatEvent): Group {
    const group = new Group();
    const hull = new MeshBasicMaterial({ color: 0x343a34 });
    const darkMetal = new MeshBasicMaterial({ color: 0x171b19 });
    const noseMaterial = new MeshBasicMaterial({ color: 0x222724 });
    const warningBand = new MeshBasicMaterial({ color: 0x713a2c });
    const serviceBand = new MeshBasicMaterial({ color: 0x7a765c });
    const exhaust = new MeshBasicMaterial({ color: 0xff7c2d, transparent: true, opacity: 0.9, depthWrite: false });
    const exhaustGlow = new MeshBasicMaterial({ color: 0xffb14d, transparent: true, opacity: 0.42, depthWrite: false });

    const body = new Mesh(new CylinderGeometry(0.46, 0.5, 5.4, 16), hull);
    const noseShoulder = new Mesh(new CylinderGeometry(0.32, 0.46, 0.62, 16), noseMaterial);
    noseShoulder.position.y = 3.01;
    const nose = new Mesh(new ConeGeometry(0.32, 1.55, 16), noseMaterial);
    nose.position.y = 4.09;
    const payloadBand = new Mesh(new CylinderGeometry(0.475, 0.475, 0.2, 16), warningBand);
    payloadBand.position.y = 1.82;
    const serviceCollar = new Mesh(new CylinderGeometry(0.485, 0.485, 0.14, 16), serviceBand);
    serviceCollar.position.y = -0.72;
    const engineSkirt = new Mesh(new CylinderGeometry(0.44, 0.57, 0.72, 16), darkMetal);
    engineSkirt.position.y = -3.06;
    const nozzle = new Mesh(new CylinderGeometry(0.24, 0.36, 0.48, 14), darkMetal.clone());
    nozzle.position.y = -3.64;
    group.add(body, noseShoulder, nose, payloadBand, serviceCollar, engineSkirt, nozzle);

    for (let index = 0; index < 4; index++) {
      const angle = (index / 4) * Math.PI * 2;
      const fin = new Mesh(new BoxGeometry(0.13, 1.45, 1.2), darkMetal.clone());
      fin.position.y = -2.35;
      fin.position.x = Math.cos(angle) * 0.48;
      fin.position.z = Math.sin(angle) * 0.48;
      fin.rotation.y = angle;
      group.add(fin);

      const canard = new Mesh(new BoxGeometry(0.07, 0.65, 0.48), hull.clone());
      canard.position.y = 1.42;
      canard.position.x = Math.cos(angle) * 0.43;
      canard.position.z = Math.sin(angle) * 0.43;
      canard.rotation.y = angle;
      group.add(canard);
    }

    const outerFlame = new Mesh(new ConeGeometry(0.5, 2.7, 14), exhaustGlow);
    outerFlame.rotation.x = Math.PI;
    outerFlame.position.y = -4.94;
    const coreFlame = new Mesh(new ConeGeometry(0.28, 1.9, 12), exhaust);
    coreFlame.rotation.x = Math.PI;
    coreFlame.position.y = -4.52;
    group.add(outerFlame, coreFlame);

    const upgradeScale = 1.25 * (1 + Math.max(0, (event.impactScale ?? 1) - 1) * 0.28);
    group.scale.setScalar(upgradeScale);
    return group;
  }

  private spawnWaterRipple(x: number, z: number, scale = 1): void {
    const foam = new MeshBasicMaterial({
      color: 0xe7f4f1,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: DoubleSide,
    });
    foam.userData.baseOpacity = 0.5;
    const glaze = new MeshBasicMaterial({
      color: 0x9ecfc8,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: DoubleSide,
    });
    glaze.userData.baseOpacity = 0.28;
    const inner = new Mesh(sharedWaterRippleGeometry(), glaze);
    const outer = new Mesh(sharedWaterRippleGeometry(), foam);
    inner.rotation.x = outer.rotation.x = -Math.PI / 2;
    outer.scale.setScalar(1.55);
    const group = new Group();
    group.add(inner, outer);
    group.position.set(x, this.hf.waterLevel + 0.07, z);
    group.scale.setScalar(scale);
    group.renderOrder = 28;
    this.bursts.push({ group, ttl: 0.45, total: 0.45, kind: 'ripple', materials: [foam, glaze], baseScale: scale });
    this.group.add(group);
    this.trimBursts();
  }

  private spawnSmallImpact(x: number, y: number, z: number, killed: boolean, impactScale = 1): void {
    const material = new MeshBasicMaterial({ color: 0xffb449, transparent: true, opacity: 0.72, depthWrite: false });
    const mesh = new Mesh(new SphereGeometry((killed ? 2.6 : 1.3) * impactScale, 10, 6), material);
    const group = new Group();
    group.add(mesh);
    group.position.set(x, y, z);
    group.renderOrder = 49;
    const ttl = killed ? 0.55 : 0.28;
    this.bursts.push({ group, ttl, total: ttl, kind: 'small', materials: [material], baseScale: 1 });
    this.group.add(group);
    this.trimBursts();
  }

  private spawnBombBlast(x: number, y: number, z: number, killed: boolean, baseScale = 1): void {
    const group = new Group();
    const overWater = isWaterSurfaceHit(this.hf, x, z);
    const fireMaterial = new MeshBasicMaterial({ color: killed ? 0xffc66b : 0xff9738, transparent: true, opacity: 0.54, depthWrite: false });
    const shockMaterial = new MeshBasicMaterial({ color: overWater ? 0xd5ebe8 : 0xffb861, transparent: true, opacity: 0.2, depthWrite: false, side: 2 });
    fireMaterial.userData.role = 'fire';
    shockMaterial.userData.role = 'shock';
    const fireball = new Mesh(new SphereGeometry(killed ? 3.9 : 3.0, 14, 9), fireMaterial);
    const shock = new Mesh(new RingGeometry(1.8, killed ? 6.1 : 4.9, 32), shockMaterial);
    fireball.position.y = overWater ? 0.35 : 1.05;
    shock.rotation.x = -Math.PI / 2;
    shock.position.y = 0.16;
    group.add(shock, fireball);
    const materials: MeshBasicMaterial[] = [fireMaterial, shockMaterial];
    if (!overWater) {
      const smokeMaterial = new MeshBasicMaterial({ color: 0x292520, transparent: true, opacity: 0.01, depthWrite: false });
      const scorchMaterial = new MeshBasicMaterial({ color: 0x080604, transparent: true, opacity: 0.14, depthWrite: false, side: 2 });
      const debrisMaterial = new MeshBasicMaterial({ color: 0x15120f, transparent: true, opacity: 0.42 });
      smokeMaterial.userData.role = 'smoke';
      scorchMaterial.userData.role = 'scorch';
      debrisMaterial.userData.role = 'debris';
      const smoke = new Mesh(new SphereGeometry(killed ? 4.6 : 3.7, 10, 7), smokeMaterial);
      smoke.position.y = 2.15;
      const scorch = new Mesh(new CircleGeometry(killed ? 5.0 : 4.0, 32), scorchMaterial);
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.y = 0.08;
      group.add(scorch, smoke);
      for (let i = 0; i < 5; i++) {
        const debris = new Mesh(new BoxGeometry(0.36, 0.14, 0.22), debrisMaterial);
        const angle = (i / 5) * Math.PI * 2 + (i % 2) * 0.18;
        const radius = 1.5 + (i % 3) * 0.75;
        debris.position.set(Math.cos(angle) * radius, 0.55 + (i % 3) * 0.28, Math.sin(angle) * radius);
        debris.rotation.set(0.45 + i * 0.13, angle, 0.25 + i * 0.17);
        group.add(debris);
      }
      materials.push(smokeMaterial, scorchMaterial, debrisMaterial);
    }
    group.position.set(x, overWater ? this.hf.waterLevel + 0.08 : y, z);
    group.renderOrder = 55;
    const ttl = killed ? 0.82 : 0.68;
    group.scale.setScalar(baseScale);
    this.bursts.push({ group, ttl, total: ttl, kind: 'bomb', materials, baseScale });
    this.group.add(group);
    this.trimBursts();
  }

  private spawnImpactAftermathSmoke(event: CombatEvent, y: number): void {
    const strategic = event.weaponKind === 'strategicMissile';
    const destroyedTank = event.killed && event.targetType === 'tank';
    if (!strategic && !destroyedTank && !isExplosiveSmokeImpact(event.kind)) return;

    this.softSmokeTexture ??= makeSoftSmokeTexture();
    const qualityDensity = this.visualQuality === 0 ? 1 : this.visualQuality === 1 ? 0.68 : 0.42;
    const heavyImpact = strategic || isBombImpact(event.kind) || event.kind === 'artilleryShell-impact' || event.kind === 'siegeMissile-impact';
    const fullCount = strategic ? 22 : destroyedTank ? 12 : heavyImpact ? 9 : 6;
    const count = Math.max(2, Math.round(fullCount * qualityDensity));
    const warheadScale = strategic ? Math.max(1.6, event.impactScale ?? 1.6) : Math.max(0.55, event.impactScale ?? 1);
    const baseSize = strategic ? 1.8 * warheadScale : destroyedTank ? 2.2 : heavyImpact ? 2.35 * warheadScale : 1.8 * warheadScale;
    const baseTtl = strategic ? 7.2 : destroyedTank ? 5.6 : heavyImpact ? 4.2 : 3.1;
    const spread = strategic ? 4.6 * warheadScale : destroyedTank ? 1.45 : heavyImpact ? 1.35 * warheadScale : 0.75 * warheadScale;
    const delayStep = strategic ? 0.07 : destroyedTank ? 0.2 : 0.09;
    const seed = hashScorchSeed(`${event.kind}-smoke`, event.toX, event.toZ);
    const rng = mulberry32(seed);

    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = spread * Math.sqrt(rng());
      const size = baseSize * (0.72 + rng() * 0.62);
      const opacity = (strategic ? 0.68 : destroyedTank ? 0.82 : 0.76) * (0.88 + rng() * 0.12);
      const material = new SpriteMaterial({
        map: this.softSmokeTexture,
        color: strategic
          ? rng() > 0.42 ? 0x3c3a36 : 0x5c554c
          : destroyedTank
            ? rng() > 0.35 ? 0x343734 : 0x5b5751
            : rng() > 0.5 ? 0x67635e : 0x89817a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      material.userData.baseOpacity = opacity;
      material.rotation = (rng() - 0.5) * 1.2;
      const puff = new Sprite(material);
      puff.scale.set(size * (1.05 + rng() * 0.38), size * (0.9 + rng() * 0.32), 1);
      puff.position.set(
        event.toX + Math.cos(angle) * radius,
        y + 0.65 + rng() * (strategic ? warheadScale * 1.6 : destroyedTank ? 1.4 : 0.8),
        event.toZ + Math.sin(angle) * radius,
      );
      puff.renderOrder = 57;
      this.group.add(puff);
      const ttl = baseTtl * (0.82 + rng() * 0.42);
      const drift = (strategic ? 0.75 : destroyedTank ? 0.62 : 0.48) * (0.45 + rng());
      this.smokePuffs.push({
        mesh: puff,
        material,
        velocity: new Vector3(Math.cos(angle) * drift, strategic ? 0.82 + rng() * 0.9 : destroyedTank ? 0.48 + rng() * 0.5 : 0.36 + rng() * 0.38, Math.sin(angle) * drift),
        ttl,
        total: ttl,
        spin: (rng() - 0.5) * 0.38,
        baseScale: puff.scale.clone(),
        growth: strategic ? 1.5 + rng() * 1.4 : destroyedTank ? 1.15 + rng() * 0.9 : 0.85 + rng() * 0.65,
        delay: i * delayStep * (0.72 + rng() * 0.65),
        fadeIn: strategic ? 0.12 : 0.18,
        fadePower: strategic ? 1.15 : destroyedTank ? 1.25 : 1.45,
      });
    }

    const maxSmoke = this.visualQuality === 0 ? 190 : this.visualQuality === 1 ? 118 : 68;
    while (this.smokePuffs.length > maxSmoke) this.disposeSmokePuff(this.smokePuffs.shift());
  }

  private spawnStrategicBlast(event: CombatEvent, y: number): void {
    const warheadScale = Math.max(1.6, event.impactScale ?? 1.6);
    this.spawnBombBlast(event.toX, y, event.toZ, event.killed, warheadScale * 1.2);

    const group = new Group();
    const flashMaterial = new MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.96, depthWrite: false });
    const fireMaterial = new MeshBasicMaterial({ color: 0xff6a24, transparent: true, opacity: 0.72, depthWrite: false });
    const shockMaterial = new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.48, depthWrite: false, side: 2 });
    const smokeMaterial = new MeshBasicMaterial({ color: 0x211c18, transparent: true, opacity: 0.18, depthWrite: false });
    flashMaterial.userData.role = 'fire';
    fireMaterial.userData.role = 'fire';
    shockMaterial.userData.role = 'shock';
    smokeMaterial.userData.role = 'smoke';

    const flash = new Mesh(new SphereGeometry(3.6, 18, 12), flashMaterial);
    const fireball = new Mesh(new SphereGeometry(5.2, 18, 12), fireMaterial);
    const innerRing = new Mesh(new RingGeometry(3.2, 10.5, 48), shockMaterial);
    const outerRing = new Mesh(new RingGeometry(8.5, 17, 64), shockMaterial.clone());
    const smokeColumn = new Mesh(new CylinderGeometry(2.6, 5.4, 10, 14), smokeMaterial);
    flash.position.y = 1.8;
    fireball.position.y = 3.1;
    smokeColumn.position.y = 6.2;
    innerRing.rotation.x = -Math.PI / 2;
    outerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.12;
    outerRing.position.y = 0.18;
    group.add(innerRing, outerRing, flash, fireball, smokeColumn);
    group.position.set(event.toX, y, event.toZ);
    group.renderOrder = 58;
    const baseScale = warheadScale * 0.88;
    group.scale.setScalar(baseScale);
    this.bursts.push({
      group,
      ttl: 1.45,
      total: 1.45,
      kind: 'bomb',
      materials: [flashMaterial, fireMaterial, shockMaterial, outerRing.material as MeshBasicMaterial, smokeMaterial],
      baseScale,
    });
    this.group.add(group);
    this.trimBursts();
  }

  private trimBursts(): void {
    const maxBursts = this.visualQuality === 0 ? 56 : this.visualQuality === 1 ? 38 : 24;
    while (this.bursts.length > maxBursts) this.disposeBurst(this.bursts.shift());
  }

  private disposeBurst(burst?: Burst): void {
    if (!burst) return;
    this.group.remove(burst.group);
    burst.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (object.geometry !== sharedRippleGeometry) object.geometry.dispose();
    });
    for (const material of burst.materials) material.dispose();
  }

  private spawnCrashBlast(x: number, y: number, z: number): void {
    this.spawnBombBlast(x, y, z, true);
    const material = new MeshBasicMaterial({ color: 0xff6a2d, transparent: true, opacity: 0.32, depthWrite: false, side: 2 });
    const ring = new Mesh(new RingGeometry(2.6, 10.5, 48), material);
    ring.rotation.x = -Math.PI / 2;
    const group = new Group();
    group.add(ring);
    group.position.set(x, y + 0.12, z);
    group.renderOrder = 56;
    this.bursts.push({ group, ttl: 1.05, total: 1.05, kind: 'bomb', materials: [material], baseScale: 1 });
    this.group.add(group);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const smokeMaterial = new MeshBasicMaterial({ color: 0x1f1d1a, transparent: true, opacity: 0.42, depthWrite: false });
      smokeMaterial.userData.baseOpacity = 0.42;
      const puff = new Mesh(new SphereGeometry(0.55 + (i % 3) * 0.12, 8, 5), smokeMaterial);
      puff.position.set(x + Math.cos(angle) * 1.5, y + 0.8 + (i % 4) * 0.2, z + Math.sin(angle) * 1.5);
      puff.renderOrder = 57;
      this.group.add(puff);
      this.smokePuffs.push({
        mesh: puff,
        material: smokeMaterial,
        velocity: new Vector3(Math.cos(angle) * 2.1, 1.25 + (i % 3) * 0.35, Math.sin(angle) * 2.1),
        ttl: 1.55,
        total: 1.55,
        spin: i % 2 ? 0.5 : -0.5,
      });
    }
    const maxSmoke = this.visualQuality === 0 ? 90 : this.visualQuality === 1 ? 58 : 36;
    while (this.smokePuffs.length > maxSmoke) this.disposeSmokePuff(this.smokePuffs.shift());
  }

  private spawnAircraftCrashSmoke(event: CombatEvent, y: number): void {
    const variant = Math.abs(event.targetId ?? 0) % 3;
    const smokeMaterial = new MeshBasicMaterial({
      color: variant === 0 ? 0x211f1c : variant === 1 ? 0x302b25 : 0x181817,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    smokeMaterial.userData.baseOpacity = 0.38;
    const puff = new Mesh(new SphereGeometry(0.72 + variant * 0.1, 8, 5), smokeMaterial);
    puff.position.set(event.toX, y, event.toZ);
    puff.renderOrder = 57;
    this.group.add(puff);
    const dx = event.toX - event.fromX;
    const dz = event.toZ - event.fromZ;
    const ttl = 1.3 + variant * 0.12;
    this.smokePuffs.push({
      mesh: puff,
      material: smokeMaterial,
      velocity: new Vector3(-dx * 1.8, 0.85 + variant * 0.16, -dz * 1.8),
      ttl,
      total: ttl,
      spin: variant === 1 ? -0.55 : 0.48,
    });
    const maxSmoke = this.visualQuality === 0 ? 110 : this.visualQuality === 1 ? 68 : 42;
    while (this.smokePuffs.length > maxSmoke) this.disposeSmokePuff(this.smokePuffs.shift());
  }

  private spawnHitIndicator(event: CombatEvent): void {
    const localOrCritical = event.sourceTeamId === this.localTeam || event.killed;
    if (!localOrCritical && this.visualQuality >= 2) return;
    if (
      !localOrCritical &&
      this.visualQuality === 1 &&
      (Math.abs(Math.floor(event.toX * 7) + Math.floor(event.toZ * 11)) & 1) === 1
    ) return;
    const texture = makeHitTexture(event);
    const material = new SpriteMaterial({ map: texture, transparent: true, opacity: 1, depthWrite: false, depthTest: false });
    const sprite = new Sprite(material);
    const y = sampleHeight(this.hf, event.toX, event.toZ) + (event.targetType === 'building' ? 8.2 : 5.1);
    sprite.position.set(event.toX, y, event.toZ);
    sprite.scale.set(10.6, 3.9, 1);
    sprite.renderOrder = 95;
    this.group.add(sprite);
    const ttl = event.sourceTeamId === this.localTeam && !this.isVisible(event.toX, event.toZ) ? 3.1 : 1.65;
    this.hitIndicators.push({ sprite, material, texture, ttl, total: ttl, rise: 0.45 });
    const maxIndicators = this.visualQuality === 0 ? 28 : this.visualQuality === 1 ? 20 : 14;
    while (this.hitIndicators.length > maxIndicators) {
      const old = this.hitIndicators.shift();
      if (!old) continue;
      this.group.remove(old.sprite);
      old.texture.dispose();
      old.material.dispose();
    }
  }
}

function makeHitTexture(event: CombatEvent): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const maxHealth = event.targetMaxHealth ?? 0;
  const health = event.targetHealth ?? 0;
  const healthPct = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
  const damagePct = maxHealth > 0 ? Math.max(1, Math.round((event.damage / maxHealth) * 100)) : Math.max(1, Math.round(event.damage));
  const title = event.killed ? 'DESTROYED' : `HIT -${damagePct}%`;
  const label = (event.targetLabel ?? 'target').slice(0, 18).toUpperCase();
  const healthText = maxHealth > 0 ? `${Math.round(healthPct * 100)}%` : '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(5, 8, 7, 0.78)';
  roundRect(ctx, 8, 8, 240, 80, 8);
  ctx.fill();
  ctx.strokeStyle = event.killed ? 'rgba(255, 94, 67, 0.95)' : 'rgba(240, 213, 106, 0.92)';
  ctx.lineWidth = 3;
  roundRect(ctx, 8, 8, 240, 80, 8);
  ctx.stroke();
  ctx.font = '700 22px ui-monospace, Menlo, monospace';
  ctx.fillStyle = event.killed ? '#ff6a54' : '#f0d56a';
  ctx.fillText(title, 22, 34);
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#dce8df';
  ctx.fillText(`${label}${healthText ? `  ${healthText}` : ''}`, 22, 53);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  roundRect(ctx, 22, 64, 212, 10, 4);
  ctx.fill();
  ctx.fillStyle = healthPct < 0.3 ? '#ff5142' : healthPct < 0.62 ? '#ffc04a' : '#79f06f';
  roundRect(ctx, 22, 64, Math.max(4, 212 * healthPct), 10, 4);
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function bezier(from: Vector3, control: Vector3, to: Vector3, t: number): Vector3 {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return new Vector3(from.x * a + control.x * b + to.x * c, from.y * a + control.y * b + to.y * c, from.z * a + control.z * b + to.z * c);
}

function bezierTangent(from: Vector3, control: Vector3, to: Vector3, t: number): Vector3 {
  return new Vector3(
    2 * (1 - t) * (control.x - from.x) + 2 * t * (to.x - control.x),
    2 * (1 - t) * (control.y - from.y) + 2 * t * (to.y - control.y),
    2 * (1 - t) * (control.z - from.z) + 2 * t * (to.z - control.z),
  );
}

function isProjectileLaunch(kind: string): boolean {
  return isBombKind(kind) || kind === 'grenade' || kind === 'kineticShell' || kind === 'artilleryShell' || kind === 'atRocket' || kind === 'scoutMissile' || kind === 'tankMissile' || kind === 'siegeMissile' || kind === 'agMissile' || kind === 'aaMissile';
}

function isProjectileImpact(kind: string): boolean {
  return isBombImpact(kind) || kind === 'grenade-impact' || kind === 'kineticShell-impact' || kind === 'artilleryShell-impact' || kind === 'atRocket-impact' || isTankMissileImpact(kind) || kind === 'agMissile-impact' || kind === 'aaMissile-impact';
}

function isExplosiveSmokeImpact(kind: string): boolean {
  return isProjectileImpact(kind);
}

function isBombKind(kind: string): boolean {
  return kind === 'bomb' || kind === 'tankBomb';
}

function isBombImpact(kind: string): boolean {
  return kind === 'bomb-impact' || kind === 'tankBomb-impact';
}

function isMissile(kind: string): boolean {
  return kind === 'agMissile' || kind === 'aaMissile' || kind === 'atRocket' || kind === 'scoutMissile' || kind === 'tankMissile' || kind === 'siegeMissile';
}

function isLargeMissile(kind: string): boolean {
  return kind === 'artilleryShell' || kind === 'agMissile' || kind === 'aaMissile' || kind === 'tankMissile' || kind === 'siegeMissile';
}

function isTankMissileImpact(kind: string): boolean {
  return kind === 'scoutMissile-impact' || kind === 'tankMissile-impact' || kind === 'siegeMissile-impact';
}

interface ProjectileVisualProfile {
  bodyColor: number;
  noseColor: number;
  bandColor: number;
  glowColor: number;
  glowOpacity: number;
  bodyRadius: number;
  tipRadius: number;
  bodyLength: number;
  noseLength: number;
  bandWidth: number;
  glowRadius: number;
  fins: number;
  finThickness: number;
  finLength: number;
  finWidth: number;
  segments: number;
  scale: number;
}

function projectileProfile(weaponKind: string, projectileKind: string): ProjectileVisualProfile {
  const base: ProjectileVisualProfile = {
    bodyColor: 0x23292b,
    noseColor: 0xd07a2a,
    bandColor: trailColor(weaponKind),
    glowColor: trailColor(weaponKind),
    glowOpacity: 0.34,
    bodyRadius: 0.22,
    tipRadius: 0.18,
    bodyLength: 1.7,
    noseLength: 0.46,
    bandWidth: 0.1,
    glowRadius: 0.46,
    fins: 3,
    finThickness: 0.07,
    finLength: 0.5,
    finWidth: 0.44,
    segments: 10,
    scale: 1.4,
  };
  if (projectileKind === 'kineticShell') return {
    ...base, bodyColor: 0x2d2a24, noseColor: 0xffe6a1, bandColor: 0xfff1b0, glowColor: 0xfff1b0,
    glowOpacity: 0.72, bodyRadius: 0.075, tipRadius: 0.045, bodyLength: 1.7, noseLength: 0.32,
    bandWidth: 0.06, glowRadius: 0.24, fins: 0, segments: 8, scale: 0.8,
  };
  if (projectileKind === 'artilleryShell') return {
    ...base, bodyColor: 0x2d302e, noseColor: 0x222321, bandColor: 0xd99a3b, glowColor: 0xff9a45,
    glowOpacity: 0.16, bodyRadius: 0.31, tipRadius: 0.22, bodyLength: 2.05, noseLength: 0.82,
    bandWidth: 0.16, glowRadius: 0.38, fins: 0, segments: 12, scale: 1.35,
  };
  if (projectileKind === 'grenade') {
    const rifle = weaponKind === 'rifleGrenade';
    return {
      ...base, bodyColor: rifle ? 0x4f5638 : 0x252b1d, noseColor: rifle ? 0xb3aa6a : 0x434b2d,
      bandColor: rifle ? 0xe1cc68 : 0xf2a44f, glowColor: rifle ? 0xe1cc68 : 0xf2a44f,
      glowOpacity: 0.2, bodyRadius: rifle ? 0.19 : 0.3, tipRadius: rifle ? 0.16 : 0.28,
      bodyLength: rifle ? 0.62 : 0.86, noseLength: rifle ? 0.2 : 0.28, bandWidth: 0.08,
      glowRadius: rifle ? 0.24 : 0.4, fins: 0, segments: 10, scale: rifle ? 0.9 : 1.15,
    };
  }
  if (weaponKind === 'rocketPod') return {
    ...base, bodyColor: 0x3d413d, noseColor: 0xdb7132, bandColor: 0xffa04a, glowColor: 0xff8b32,
    bodyRadius: 0.1, tipRadius: 0.075, bodyLength: 0.82, noseLength: 0.24, bandWidth: 0.05,
    glowRadius: 0.24, fins: 2, finThickness: 0.035, finLength: 0.22, finWidth: 0.2, segments: 8, scale: 0.95,
  };
  if (weaponKind === 'rocketLauncher') return {
    ...base, bodyColor: 0x4b5139, noseColor: 0xddd0a0, bandColor: 0xd37835, glowColor: 0xff9e52,
    bodyRadius: 0.19, tipRadius: 0.14, bodyLength: 1.5, noseLength: 0.56, bandWidth: 0.13,
    glowRadius: 0.46, fins: 4, finThickness: 0.06, finLength: 0.44, finWidth: 0.38, scale: 1.42,
  };
  if (weaponKind === 'scoutMissile') return {
    ...base, bodyColor: 0x343b38, noseColor: 0xb9c6a7, bandColor: 0x74c98f, glowColor: 0xc6f2bd,
    bodyRadius: 0.13, tipRadius: 0.09, bodyLength: 1.35, noseLength: 0.42, bandWidth: 0.08,
    glowRadius: 0.34, fins: 4, finThickness: 0.045, finLength: 0.35, finWidth: 0.3, scale: 1.18,
  };
  if (weaponKind === 'tankMissile') return {
    ...base, bodyColor: 0x292e31, noseColor: 0xe0d2ad, bandColor: 0xd9a844, glowColor: 0xffbd58,
    bodyRadius: 0.22, tipRadius: 0.15, bodyLength: 2.05, noseLength: 0.58, bandWidth: 0.15,
    glowRadius: 0.52, fins: 4, finThickness: 0.07, finLength: 0.56, finWidth: 0.5, scale: 1.48,
  };
  if (weaponKind === 'agMissile') return {
    ...base, bodyColor: 0x252a2e, noseColor: 0xf2d66c, bandColor: 0xe2bc4f, glowColor: 0xffd76a,
    bodyRadius: 0.2, tipRadius: 0.12, bodyLength: 2.5, noseLength: 0.72, bandWidth: 0.14,
    glowRadius: 0.56, fins: 4, finThickness: 0.06, finLength: 0.72, finWidth: 0.58, scale: 1.65,
  };
  if (weaponKind === 'aaMissile') return {
    ...base, bodyColor: 0xd8dde0, noseColor: 0x70d8ff, bandColor: 0x4ea4d8, glowColor: 0x9eeaff,
    bodyRadius: 0.12, tipRadius: 0.07, bodyLength: 2.15, noseLength: 0.62, bandWidth: 0.12,
    glowRadius: 0.38, fins: 4, finThickness: 0.045, finLength: 0.52, finWidth: 0.38, scale: 1.3,
  };
  if (weaponKind === 'strategicMissile') return {
    ...base, bodyColor: 0x343a34, noseColor: 0x222724, bandColor: 0x713a2c, glowColor: 0xff7a32,
    glowOpacity: 0.78, bodyRadius: 0.46, tipRadius: 0.32, bodyLength: 5.4, noseLength: 1.55,
    bandWidth: 0.2, glowRadius: 0.9, fins: 4, finThickness: 0.13, finLength: 1.45, finWidth: 1.2,
    segments: 16, scale: 1.25,
  };
  return projectileKind === 'tankBomb' ? { ...base, bodyRadius: 0.4, bodyLength: 2.3, scale: 2.2 } : base;
}

function projectileSmokeCadence(weaponKind: string, projectileKind: string, homing: boolean): number {
  if (weaponKind === 'strategicMissile') return 0.022;
  if (weaponKind === 'emberDrone') return 0.055;
  if (isBombKind(projectileKind)) return 0.075;
  if (projectileKind === 'grenade') return weaponKind === 'rifleGrenade' ? 0.18 : 0.12;
  if (projectileKind === 'kineticShell' || projectileKind === 'artilleryShell') return 0.2;
  if (weaponKind === 'rocketPod') return 0.075;
  if (weaponKind === 'rocketLauncher' || weaponKind === 'tankMissile') return 0.032;
  return homing ? 0.042 : 0.052;
}

function projectileSmokeOffset(weaponKind: string, projectileKind: string): number {
  if (weaponKind === 'strategicMissile') return -2.6;
  if (weaponKind === 'emberDrone') return -1.25;
  if (projectileKind === 'kineticShell') return -0.35;
  if (projectileKind === 'artilleryShell') return -0.75;
  if (weaponKind === 'rocketPod') return -0.48;
  return isLargeMissile(projectileKind) || weaponKind === 'rocketLauncher' ? -1.35 : -0.65;
}

function projectileSmokeColor(weaponKind: string, projectileKind: string, homing: boolean): number {
  if (weaponKind === 'strategicMissile') return 0x8a8e8a;
  if (weaponKind === 'emberDrone') return 0xd7c6b2;
  if (isBombKind(projectileKind)) return 0x3a3026;
  if (projectileKind === 'kineticShell') return 0xffd875;
  if (projectileKind === 'artilleryShell') return 0x71675a;
  if (weaponKind === 'aaMissile') return 0xdbeeff;
  if (weaponKind === 'rocketPod') return 0xaaa397;
  return homing ? 0xd8d3c7 : 0xb7b0a1;
}

function projectileSmokeOpacity(weaponKind: string, projectileKind: string, homing: boolean): number {
  if (weaponKind === 'strategicMissile') return 0.72;
  if (weaponKind === 'emberDrone') return 0.54;
  if (projectileKind === 'kineticShell') return 0.12;
  if (projectileKind === 'artilleryShell') return 0.18;
  if (projectileKind === 'grenade') return weaponKind === 'rifleGrenade' ? 0.13 : 0.22;
  if (weaponKind === 'rocketPod') return 0.26;
  return homing ? 0.5 : 0.34;
}

function projectileSmokeSize(weaponKind: string, projectileKind: string, homing: boolean): number {
  if (weaponKind === 'strategicMissile') return 1.7;
  if (weaponKind === 'emberDrone') return 0.42;
  if (isBombKind(projectileKind)) return 0.42;
  if (projectileKind === 'kineticShell') return 0.12;
  if (projectileKind === 'artilleryShell') return 0.2;
  if (weaponKind === 'rocketPod') return 0.2;
  if (weaponKind === 'tankMissile' || weaponKind === 'rocketLauncher') return 0.42;
  return homing ? 0.34 : 0.27;
}

function makeSoftSmokeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const lobes = [
    { x: 64, y: 65, radius: 48, alpha: 0.52 },
    { x: 39, y: 65, radius: 31, alpha: 0.34 },
    { x: 88, y: 59, radius: 35, alpha: 0.38 },
    { x: 56, y: 39, radius: 30, alpha: 0.28 },
    { x: 70, y: 87, radius: 28, alpha: 0.25 },
  ];
  for (const lobe of lobes) {
    const gradient = ctx.createRadialGradient(lobe.x, lobe.y, 0, lobe.x, lobe.y, lobe.radius);
    gradient.addColorStop(0, `rgba(255,255,255,${lobe.alpha})`);
    gradient.addColorStop(0.38, `rgba(255,255,255,${lobe.alpha * 0.72})`);
    gradient.addColorStop(0.72, `rgba(255,255,255,${lobe.alpha * 0.2})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function impactBlastScale(kind: string, weaponKind?: string): number {
  if (weaponKind === 'emberDrone') return 1.15;
  if (kind === 'kineticShell-impact') return 0.34;
  if (kind === 'artilleryShell-impact') return 1.16;
  if (kind === 'tankBomb-impact') return 1.42;
  if (kind === 'bomb-impact') return 1;
  if (kind === 'grenade-impact') return 0.58;
  if (kind === 'atRocket-impact') return weaponKind === 'rocketPod' ? 0.46 : 0.7;
  if (kind === 'scoutMissile-impact') return 0.52;
  if (kind === 'tankMissile-impact') return 0.72;
  if (kind === 'siegeMissile-impact') return 1;
  return 1;
}

function smallImpactScale(weaponKind: string): number {
  if (weaponKind === 'rifle' || weaponKind === 'microLaser' || weaponKind === 'skylanceGun') return 0.42;
  if (weaponKind === 'autocannon') return 0.62;
  if (weaponKind === 'waspAutocannon') return 0.54;
  if (weaponKind === 'sniperRifle' || weaponKind === 'railShot') return 0.76;
  if (weaponKind === 'kineticShell' || weaponKind === 'cannon') return 0.88;
  return 1;
}

export function isWaterSurfaceHit(hf: Heightfield, x: number, z: number, impactY?: number): boolean {
  const groundY = sampleHeight(hf, x, z);
  if (groundY >= hf.waterLevel - 0.02) return false;
  if (impactY !== undefined && impactY > hf.waterLevel + 1.6) return false;
  return true;
}

export function shouldPaintGroundScorch(hf: Heightfield, event: CombatEvent): boolean {
  if (!isProjectileImpact(event.kind)) return false;
  const groundY = sampleHeight(hf, event.toX, event.toZ);
  if (groundY < hf.waterLevel - 0.02) return false;
  const impactY = event.toY ?? groundY;
  return impactY <= groundY + 4.5;
}

function waterRippleScale(kind: string, weaponKind?: string): number {
  if (weaponKind === 'strategicMissile' || kind === 'tankBomb-impact' || kind === 'bomb-impact') return 2.4;
  if (kind === 'artilleryShell-impact' || kind === 'siegeMissile-impact' || kind === 'agMissile-impact') return 1.85;
  if (kind === 'kineticShell-impact' || kind === 'cannon') return 1.35;
  if (kind === 'rifle' || kind === 'overchargeRifle' || kind === 'microLaser') return 0.82;
  return 1.15;
}

let sharedRippleGeometry: RingGeometry | undefined;
function sharedWaterRippleGeometry(): RingGeometry {
  return (sharedRippleGeometry ??= new RingGeometry(0.28, 0.72, 24));
}

function scorchProfile(kind: string, killed: boolean, weaponKind?: string): { size: number; opacity: number; ttl: number } {
  if (weaponKind === 'strategicMissile') return { size: killed ? 34 : 28, opacity: 0.82, ttl: killed ? 110 : 90 };
  if (kind === 'artilleryShell-impact') return { size: killed ? 15.5 : 12.8, opacity: 0.68, ttl: killed ? 58 : 48 };
  if (kind === 'kineticShell-impact') return { size: killed ? 5.4 : 3.6, opacity: 0.4, ttl: 24 };
  if (kind === 'tankBomb-impact') return { size: killed ? 18.5 : 15.2, opacity: 0.7, ttl: killed ? 66 : 54 };
  if (kind === 'bomb-impact') return { size: killed ? 13.5 : 10.5, opacity: 0.62, ttl: killed ? 54 : 42 };
  if (kind === 'agMissile-impact') return { size: killed ? 11.5 : 8.6, opacity: 0.58, ttl: killed ? 48 : 38 };
  if (kind === 'grenade-impact') return { size: killed ? 7.4 : 5.8, opacity: 0.5, ttl: 30 };
  if (kind === 'atRocket-impact') return { size: killed ? 6.9 : 5.2, opacity: 0.48, ttl: 28 };
  if (kind === 'scoutMissile-impact') return { size: killed ? 6.4 : 4.8, opacity: 0.47, ttl: 28 };
  if (kind === 'tankMissile-impact') return { size: killed ? 8.6 : 6.8, opacity: 0.53, ttl: 34 };
  if (kind === 'siegeMissile-impact') return { size: killed ? 11.8 : 9.2, opacity: 0.6, ttl: 42 };
  if (kind === 'aaMissile-impact') return { size: killed ? 7.2 : 5.4, opacity: 0.44, ttl: 28 };
  return { size: 5.5, opacity: 0.46, ttl: 28 };
}

function makeScorchTexture(kind: string, x: number, z: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const rng = mulberry32(hashScorchSeed(kind, x, z));
  ctx.clearRect(0, 0, 256, 256);

  const centerX = 128 + (rng() - 0.5) * 10;
  const centerY = 128 + (rng() - 0.5) * 10;
  const radius = kind === 'tankBomb-impact' ? 108 : kind === 'bomb-impact' || kind === 'agMissile-impact' ? 92 : kind === 'grenade-impact' ? 70 : 62;
  const edge = 28 + rng() * 16;

  const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.08, centerX, centerY, radius);
  gradient.addColorStop(0, 'rgba(0,0,0,0.86)');
  gradient.addColorStop(0.2, 'rgba(18,12,8,0.78)');
  gradient.addColorStop(0.52, 'rgba(34,25,18,0.48)');
  gradient.addColorStop(0.78, 'rgba(76,61,44,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * Math.PI * 2;
    const wobble = 1 + Math.sin(angle * 3.7 + rng() * 0.8) * 0.08 + (rng() - 0.5) * 0.16;
    const r = radius * wobble;
    const px = centerX + Math.cos(angle) * r;
    const py = centerY + Math.sin(angle) * r * (0.88 + rng() * 0.1);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 32; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = radius * (0.22 + rng() * 0.62);
    const dotR = 2 + rng() * (kind === 'tankBomb-impact' ? 9 : kind === 'bomb-impact' ? 7 : 4);
    ctx.fillStyle = `rgba(${22 + rng() * 30},${17 + rng() * 20},${11 + rng() * 12},${0.14 + rng() * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(centerX + Math.cos(angle) * dist, centerY + Math.sin(angle) * dist, dotR * (1.2 + rng()), dotR, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(15, 11, 8, 0.34)';
  ctx.lineWidth = kind === 'tankBomb-impact' ? 2.8 : kind === 'bomb-impact' || kind === 'agMissile-impact' ? 2.2 : 1.4;
  const cracks = kind === 'tankBomb-impact' ? 12 : kind === 'bomb-impact' || kind === 'agMissile-impact' ? 9 : 5;
  for (let i = 0; i < cracks; i++) {
    const angle = rng() * Math.PI * 2;
    const start = radius * (0.16 + rng() * 0.18);
    const length = radius * (0.28 + rng() * 0.32);
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(angle) * start, centerY + Math.sin(angle) * start);
    const midA = angle + (rng() - 0.5) * 0.35;
    ctx.lineTo(centerX + Math.cos(midA) * (start + length * 0.52), centerY + Math.sin(midA) * (start + length * 0.52));
    const endA = angle + (rng() - 0.5) * 0.45;
    ctx.lineTo(centerX + Math.cos(endA) * (start + length), centerY + Math.sin(endA) * (start + length));
    ctx.stroke();
  }

  const rim = ctx.createRadialGradient(centerX, centerY, radius - edge, centerX, centerY, radius + edge * 0.5);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(0.55, 'rgba(103,85,58,0.18)');
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function deterministicAngle(x: number, z: number, kind: string): number {
  return mulberry32(hashScorchSeed(kind, x, z))() * Math.PI * 2;
}

function hashScorchSeed(kind: string, x: number, z: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ Math.round(x * 31), 0x01000193);
  h = Math.imul(h ^ Math.round(z * 37), 0x01000193);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function trailColor(kind: string): number {
  if (kind === 'kineticShell') return 0xfff1b0;
  if (kind === 'artilleryShell') return 0xff9a45;
  if (kind === 'aaMissile') return 0x70d8ff;
  if (kind === 'agMissile') return 0xffd76a;
  if (kind === 'rocketPod') return 0xff8b32;
  if (kind === 'rocketLauncher') return 0xffb06a;
  if (kind === 'scoutMissile') return 0x9de2a9;
  if (kind === 'tankMissile') return 0xffbd58;
  if (kind === 'rifleGrenade') return 0xe1cc68;
  if (kind === 'atRocket') return 0xff9e52;
  if (kind === 'grenade') return 0xf2b35e;
  return 0xff8f36;
}
