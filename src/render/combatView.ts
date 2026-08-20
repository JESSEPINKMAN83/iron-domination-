import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
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
  kind: 'small' | 'bomb';
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
  event: CombatEvent;
  smokeTimer: number;
  direction?: Vector3;
  trailCapacity: number;
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
  mesh: Mesh;
  material: MeshBasicMaterial;
  velocity: Vector3;
  ttl: number;
  total: number;
  spin: number;
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
    (event) => event.kind !== 'ore-delivery' && event.kind !== 'impact-reaction' && event.kind !== 'strategic-missile-warning',
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
  return event.killed || event.kind === 'crash' || event.kind === 'aircraft-crash-smoke';
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
  private readonly tracers: Tracer[] = [];
  private readonly bursts: Burst[] = [];
  private readonly bombProjectiles: BombProjectile[] = [];
  private readonly hitIndicators: HitIndicator[] = [];
  private readonly smokePuffs: SmokePuff[] = [];
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
      const muzzleHeight = isBombKind(event.kind) ? 3.1 : event.kind === 'sniperRifle' ? 1.72 : event.kind === 'rifle' ? 1.35 : event.kind === 'microLaser' ? 2.75 : 2.2;
      const fromY = event.fromY ?? sampleHeight(this.hf, event.fromX, event.fromZ) + muzzleHeight;
      const toY = event.toY ?? sampleHeight(this.hf, event.toX, event.toZ) + 1.4;
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
        if (shouldPaintGroundScorch(this.hf, event)) this.spawnGroundScorch(event);
        if (isBombImpact(event.kind) || event.kind === 'grenade-impact' || event.kind === 'artilleryShell-impact' || event.kind === 'agMissile-impact' || isTankMissileImpact(event.kind)) {
          const impactY = event.targetType === 'aircraft'
            ? toY
            : sampleHeight(this.hf, event.toX, event.toZ) + 0.4;
          this.spawnBombBlast(
            event.toX,
            impactY,
            event.toZ,
            event.killed,
            impactBlastScale(event.kind, event.weaponKind) * (event.impactScale ?? 1),
          );
        } else {
          this.spawnSmallImpact(event.toX, toY, event.toZ, event.killed, (event.impactScale ?? 1) * smallImpactScale(event.weaponKind ?? event.kind));
        }
        if (event.damage > 0 || event.killed) {
          this.spawnHitIndicator(event);
          this.spawnHitFragments(event, toY);
        }
        continue;
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([event.fromX, fromY, event.fromZ, event.toX, toY, event.toZ], 3));
      const line = new Line(
        geometry,
        event.kind === 'microLaser'
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

      this.spawnSmallImpact(event.toX, toY, event.toZ, event.killed, (event.impactScale ?? 1) * smallImpactScale(event.weaponKind ?? event.kind));
      if (event.kind !== 'microLaser' && (event.damage > 0 || event.killed)) {
        this.spawnHitIndicator(event);
        this.spawnHitFragments(event, toY);
      }
    }
  }

  update(dt: number): void {
    this.updateBombProjectiles(dt);
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
      } else {
        burst.group.scale.multiplyScalar(1 + dt * 2.2);
        for (const material of burst.materials) material.opacity = life * 0.72;
      }
      if (burst.ttl <= 0) {
        this.group.remove(burst.group);
        burst.group.traverse((object) => {
          if (object instanceof Mesh) object.geometry.dispose();
        });
        for (const material of burst.materials) material.dispose();
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
    const controlY = drop
      ? Math.max(toY + 2, (fromY + toY) * 0.46 - Math.min(16, distance * 0.04))
      : flat
        ? (fromY + toY) * 0.5
        : Math.max(fromY, toY) + Math.min(190, distance * 0.24);
    const control = new Vector3((event.fromX + event.toX) / 2, controlY, (event.fromZ + event.toZ) / 2);
    const group = this.makeProjectileMesh(event);
    group.position.copy(from);
    group.renderOrder = 60;
    this.group.add(group);

    const homing = event.trajectory === 'homing';
    const trailCapacity = homing ? 20 : 8;
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
      event,
      smokeTimer: 0,
      direction: homing ? to.clone().sub(from).normalize() : undefined,
      trailCapacity,
    });
    const maxProjectiles = this.visualQuality === 0 ? 72 : this.visualQuality === 1 ? 48 : 28;
    while (this.bombProjectiles.length > maxProjectiles) this.disposeBombProjectile(this.bombProjectiles.shift());
  }

  private updateBombProjectiles(dt: number): void {
    for (let i = this.bombProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.bombProjectiles[i];
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
    const baseCadence = projectileSmokeCadence(visualKind, projectile.event.kind, homing);
    const cadence = baseCadence * (this.visualQuality === 0 ? 1 : this.visualQuality === 1 ? 1.7 : 2.8);
    if (projectile.smokeTimer > 0) return;
    projectile.smokeTimer = cadence;
    const pos = projectile.group.position.clone();
    const back = tangent.clone().multiplyScalar(projectileSmokeOffset(visualKind, projectile.event.kind));
    pos.add(back);
    pos.x += Math.sin(projectile.elapsed * 19 + projectile.event.fromX) * 0.12;
    pos.z += Math.cos(projectile.elapsed * 17 + projectile.event.fromZ) * 0.12;
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
      puff.ttl -= dt;
      const life = Math.max(0, puff.ttl / puff.total);
      const age = 1 - life;
      puff.mesh.position.addScaledVector(puff.velocity, dt);
      puff.mesh.rotation.y += puff.spin * dt;
      puff.mesh.scale.setScalar(1 + age * 2.6);
      puff.material.opacity = (puff.material.userData.baseOpacity as number) * life * life;
      if (puff.ttl <= 0) {
        this.disposeSmokePuff(puff);
        this.smokePuffs.splice(i, 1);
      }
    }
  }

  private disposeSmokePuff(puff?: SmokePuff): void {
    if (!puff) return;
    this.group.remove(puff.mesh);
    puff.mesh.geometry.dispose();
    puff.material.dispose();
  }

  private spawnHitFragments(event: CombatEvent, y: number): void {
    const heavy = isBombImpact(event.kind);
    const fullCount = heavy ? 18 : isTankMissileImpact(event.kind) || event.killed ? 11 : 6;
    const density = this.visualQuality === 0 ? 1 : this.visualQuality === 1 ? 0.65 : 0.38;
    const count = Math.max(2, Math.round(fullCount * density));
    const force = heavy ? 8.5 : isTankMissileImpact(event.kind) ? 6.4 : 4.2;
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
    const profile = scorchProfile(event.kind, event.killed);
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
    const fireMaterial = new MeshBasicMaterial({ color: killed ? 0xffc66b : 0xff9738, transparent: true, opacity: 0.54, depthWrite: false });
    const smokeMaterial = new MeshBasicMaterial({ color: 0x292520, transparent: true, opacity: 0.01, depthWrite: false });
    const shockMaterial = new MeshBasicMaterial({ color: 0xffb861, transparent: true, opacity: 0.2, depthWrite: false, side: 2 });
    const scorchMaterial = new MeshBasicMaterial({ color: 0x080604, transparent: true, opacity: 0.14, depthWrite: false, side: 2 });
    const debrisMaterial = new MeshBasicMaterial({ color: 0x15120f, transparent: true, opacity: 0.42 });
    smokeMaterial.userData.role = 'smoke';
    shockMaterial.userData.role = 'shock';
    scorchMaterial.userData.role = 'scorch';
    debrisMaterial.userData.role = 'debris';
    fireMaterial.userData.role = 'fire';
    const fireball = new Mesh(new SphereGeometry(killed ? 3.9 : 3.0, 14, 9), fireMaterial);
    const smoke = new Mesh(new SphereGeometry(killed ? 4.6 : 3.7, 10, 7), smokeMaterial);
    const shock = new Mesh(new RingGeometry(1.8, killed ? 6.1 : 4.9, 32), shockMaterial);
    const scorch = new Mesh(new CircleGeometry(killed ? 5.0 : 4.0, 32), scorchMaterial);
    fireball.position.y = 1.05;
    smoke.position.y = 2.15;
    shock.rotation.x = -Math.PI / 2;
    shock.position.y = 0.16;
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.08;
    group.add(scorch, shock, fireball, smoke);
    for (let i = 0; i < 5; i++) {
      const debris = new Mesh(new BoxGeometry(0.36, 0.14, 0.22), debrisMaterial);
      const angle = (i / 5) * Math.PI * 2 + (i % 2) * 0.18;
      const radius = 1.5 + (i % 3) * 0.75;
      debris.position.set(Math.cos(angle) * radius, 0.55 + (i % 3) * 0.28, Math.sin(angle) * radius);
      debris.rotation.set(0.45 + i * 0.13, angle, 0.25 + i * 0.17);
      group.add(debris);
    }
    group.position.set(x, y, z);
    group.renderOrder = 55;
    const ttl = killed ? 0.82 : 0.68;
    group.scale.setScalar(baseScale);
    this.bursts.push({ group, ttl, total: ttl, kind: 'bomb', materials: [fireMaterial, smokeMaterial, shockMaterial, scorchMaterial, debrisMaterial], baseScale });
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
      if (object instanceof Mesh) object.geometry.dispose();
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
  return projectileKind === 'tankBomb' ? { ...base, bodyRadius: 0.4, bodyLength: 2.3, scale: 2.2 } : base;
}

function projectileSmokeCadence(weaponKind: string, projectileKind: string, homing: boolean): number {
  if (isBombKind(projectileKind)) return 0.075;
  if (projectileKind === 'grenade') return weaponKind === 'rifleGrenade' ? 0.18 : 0.12;
  if (projectileKind === 'kineticShell' || projectileKind === 'artilleryShell') return 0.2;
  if (weaponKind === 'rocketPod') return 0.075;
  if (weaponKind === 'rocketLauncher' || weaponKind === 'tankMissile') return 0.032;
  return homing ? 0.042 : 0.052;
}

function projectileSmokeOffset(weaponKind: string, projectileKind: string): number {
  if (projectileKind === 'kineticShell') return -0.35;
  if (projectileKind === 'artilleryShell') return -0.75;
  if (weaponKind === 'rocketPod') return -0.48;
  return isLargeMissile(projectileKind) || weaponKind === 'rocketLauncher' ? -1.35 : -0.65;
}

function projectileSmokeColor(weaponKind: string, projectileKind: string, homing: boolean): number {
  if (isBombKind(projectileKind)) return 0x3a3026;
  if (projectileKind === 'kineticShell') return 0xffd875;
  if (projectileKind === 'artilleryShell') return 0x71675a;
  if (weaponKind === 'aaMissile') return 0xdbeeff;
  if (weaponKind === 'rocketPod') return 0xaaa397;
  return homing ? 0xd8d3c7 : 0xb7b0a1;
}

function projectileSmokeOpacity(weaponKind: string, projectileKind: string, homing: boolean): number {
  if (projectileKind === 'kineticShell') return 0.12;
  if (projectileKind === 'artilleryShell') return 0.18;
  if (projectileKind === 'grenade') return weaponKind === 'rifleGrenade' ? 0.13 : 0.22;
  if (weaponKind === 'rocketPod') return 0.26;
  return homing ? 0.5 : 0.34;
}

function projectileSmokeSize(weaponKind: string, projectileKind: string, homing: boolean): number {
  if (isBombKind(projectileKind)) return 0.42;
  if (projectileKind === 'kineticShell') return 0.12;
  if (projectileKind === 'artilleryShell') return 0.2;
  if (weaponKind === 'rocketPod') return 0.2;
  if (weaponKind === 'tankMissile' || weaponKind === 'rocketLauncher') return 0.42;
  return homing ? 0.34 : 0.27;
}

function impactBlastScale(kind: string, weaponKind?: string): number {
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
  if (weaponKind === 'rifle' || weaponKind === 'microLaser') return 0.42;
  if (weaponKind === 'autocannon') return 0.62;
  if (weaponKind === 'waspAutocannon') return 0.54;
  if (weaponKind === 'sniperRifle' || weaponKind === 'railShot') return 0.76;
  if (weaponKind === 'kineticShell' || weaponKind === 'cannon') return 0.88;
  return 1;
}

function shouldPaintGroundScorch(hf: Heightfield, event: CombatEvent): boolean {
  if (!isProjectileImpact(event.kind)) return false;
  const groundY = sampleHeight(hf, event.toX, event.toZ);
  const impactY = event.toY ?? groundY;
  return impactY <= groundY + 4.5;
}

function scorchProfile(kind: string, killed: boolean): { size: number; opacity: number; ttl: number } {
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
