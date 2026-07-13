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

export class CombatView {
  readonly group = new Group();
  private readonly cannonMaterial = new LineBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.92 });
  private readonly rifleMaterial = new LineBasicMaterial({ color: 0xff8f62, transparent: true, opacity: 0.8 });
  private readonly sniperMaterial = new LineBasicMaterial({ color: 0xd8ffd0, transparent: true, opacity: 0.96 });
  private readonly tracers: Tracer[] = [];
  private readonly bursts: Burst[] = [];
  private readonly bombProjectiles: BombProjectile[] = [];
  private readonly hitIndicators: HitIndicator[] = [];
  private readonly smokePuffs: SmokePuff[] = [];
  private readonly hitFragments: HitFragment[] = [];
  private readonly groundScorches: GroundScorch[] = [];
  private readonly up = new Vector3(0, 1, 0);

  constructor(
    private readonly hf: Heightfield,
    private readonly isVisible: (x: number, z: number) => boolean = () => true,
  ) {}

  push(events: CombatEvent[]): void {
    for (const event of events) {
      if (event.kind === 'ore-delivery') continue;
      const sourceVisible = this.isVisible(event.fromX, event.fromZ);
      const impactVisible = this.isVisible(event.toX, event.toZ);
      const playerHiddenHit = event.sourceTeamId === 1 && event.damage > 0;
      // fights entirely inside the fog stay hidden, except brief player-fired hit confirmations
      if (!sourceVisible && !impactVisible && !playerHiddenHit) continue;
      const muzzleHeight = isBombKind(event.kind) ? 3.1 : event.kind === 'sniperRifle' ? 1.72 : event.kind === 'rifle' ? 1.35 : 2.2;
      const fromY = event.fromY ?? sampleHeight(this.hf, event.fromX, event.fromZ) + muzzleHeight;
      const toY = event.toY ?? sampleHeight(this.hf, event.toX, event.toZ) + 1.4;
      if (event.kind === 'crash') {
        this.spawnCrashBlast(event.toX, sampleHeight(this.hf, event.toX, event.toZ) + 0.6, event.toZ);
        continue;
      }
      if (isProjectileLaunch(event.kind)) {
        this.spawnBombProjectile(event, fromY, toY);
        continue;
      }
      if (isProjectileImpact(event.kind)) {
        if (shouldPaintGroundScorch(this.hf, event)) this.spawnGroundScorch(event);
        if (isBombImpact(event.kind) || event.kind === 'grenade-impact' || event.kind === 'agMissile-impact' || isTankMissileImpact(event.kind)) {
          this.spawnBombBlast(
            event.toX,
            sampleHeight(this.hf, event.toX, event.toZ) + 0.4,
            event.toZ,
            event.killed,
            impactBlastScale(event.kind),
          );
        } else {
          this.spawnSmallImpact(event.toX, toY, event.toZ, event.killed);
        }
        if (event.damage > 0 || event.killed) {
          this.spawnHitIndicator(event);
          this.spawnHitFragments(event, toY);
        }
        continue;
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([event.fromX, fromY, event.fromZ, event.toX, toY, event.toZ], 3));
      const line = new Line(geometry, event.kind === 'sniperRifle' || event.kind === 'railShot' ? this.sniperMaterial : event.kind === 'rifle' || event.kind === 'overchargeRifle' ? this.rifleMaterial : this.cannonMaterial);
      line.renderOrder = 50;
      const tracerTtl = event.kind === 'sniperRifle' || event.kind === 'railShot' ? 0.34 : event.kind === 'rifle' || event.kind === 'overchargeRifle' ? 0.08 : 0.16;
      this.tracers.push({ line, ttl: tracerTtl, total: tracerTtl });
      this.group.add(line);

      this.spawnSmallImpact(event.toX, toY, event.toZ, event.killed);
      if (event.damage > 0 || event.killed) {
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
        this.group.remove(tracer.line);
        tracer.line.geometry.dispose();
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
        : Math.max(fromY, toY) + Math.min(84, distance * 0.28);
    const control = new Vector3((event.fromX + event.toX) / 2, controlY, (event.fromZ + event.toZ) / 2);
    const group = this.makeProjectileMesh(event.kind);
    group.position.copy(from);
    group.renderOrder = 60;
    this.group.add(group);

    const trailGeometry = new BufferGeometry();
    trailGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(8 * 3), 3));
    const trail = new Line(trailGeometry, new LineBasicMaterial({ color: trailColor(event.kind), transparent: true, opacity: 0.5 }));
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
      duration: event.duration ?? Math.min(3.4, Math.max(0.85, distance / 95)),
      event,
      smokeTimer: 0,
    });
  }

  private updateBombProjectiles(dt: number): void {
    for (let i = this.bombProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.bombProjectiles[i];
      projectile.elapsed += dt;
      const t = Math.min(1, projectile.elapsed / projectile.duration);
      const position = bezier(projectile.from, projectile.control, projectile.to, t);
      const tangent = bezierTangent(projectile.from, projectile.control, projectile.to, t).normalize();
      projectile.group.position.copy(position);
      projectile.group.quaternion.copy(new Quaternion().setFromUnitVectors(this.up, tangent));
      projectile.trailPositions.push(position.clone());
      if (projectile.trailPositions.length > 8) projectile.trailPositions.shift();
      this.updateTrail(projectile);
      this.emitProjectileSmoke(projectile, tangent, dt);
      if (t >= 1) {
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
        // the blast is driven by the sim's 'bomb-impact' event, not the visual flight
        this.bombProjectiles.splice(i, 1);
      }
    }
  }

  private updateTrail(projectile: BombProjectile): void {
    const attribute = projectile.trail.geometry.getAttribute('position') as Float32BufferAttribute;
    const first = projectile.trailPositions[0];
    for (let i = 0; i < 8; i++) {
      const p = projectile.trailPositions[i] ?? first;
      attribute.setXYZ(i, p.x, p.y, p.z);
    }
    attribute.needsUpdate = true;
    const material = projectile.trail.material as LineBasicMaterial;
    material.opacity = Math.min(0.55, projectile.elapsed / 0.18);
  }

  private emitProjectileSmoke(projectile: BombProjectile, tangent: Vector3, dt: number): void {
    projectile.smokeTimer -= dt;
    const cadence = isBombKind(projectile.event.kind) ? 0.075 : projectile.event.kind === 'grenade' ? 0.12 : 0.045;
    if (projectile.smokeTimer > 0) return;
    projectile.smokeTimer = cadence;
    const pos = projectile.group.position.clone();
    const back = tangent.clone().multiplyScalar(isLargeMissile(projectile.event.kind) ? -1.35 : -0.65);
    pos.add(back);
    pos.x += Math.sin(projectile.elapsed * 19 + projectile.event.fromX) * 0.12;
    pos.z += Math.cos(projectile.elapsed * 17 + projectile.event.fromZ) * 0.12;
    const smokeMaterial = new MeshBasicMaterial({
      color: isBombKind(projectile.event.kind) ? 0x3a3026 : 0xb7b0a1,
      transparent: true,
      opacity: projectile.event.kind === 'grenade' ? 0.22 : 0.34,
      depthWrite: false,
    });
    smokeMaterial.userData.baseOpacity = smokeMaterial.opacity;
    const puff = new Mesh(new SphereGeometry(isBombKind(projectile.event.kind) ? 0.42 : 0.28, 8, 5), smokeMaterial);
    puff.position.copy(pos);
    puff.renderOrder = 57;
    this.group.add(puff);
    this.smokePuffs.push({
      mesh: puff,
      material: smokeMaterial,
      velocity: new Vector3(-tangent.x * 0.9, 0.5 + Math.abs(tangent.y) * 0.2, -tangent.z * 0.9),
      ttl: isBombKind(projectile.event.kind) ? 0.9 : 0.68,
      total: isBombKind(projectile.event.kind) ? 0.9 : 0.68,
      spin: Math.sin(projectile.elapsed * 11 + projectile.event.toX) * 0.6,
    });
    while (this.smokePuffs.length > 90) this.disposeSmokePuff(this.smokePuffs.shift());
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
    const count = heavy ? 18 : isTankMissileImpact(event.kind) || event.killed ? 11 : 6;
    const force = heavy ? 8.5 : isTankMissileImpact(event.kind) ? 6.4 : 4.2;
    for (let i = 0; i < count; i++) {
      const seed = deterministicAngle(event.toX + i * 1.73, event.toZ - i * 0.91, event.kind);
      const angle = seed + (i / count) * Math.PI * 2;
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
      const speed = force * (0.55 + ((i * 37) % 11) / 16);
      const ttl = heavy ? 1.05 + (i % 5) * 0.06 : 0.62 + (i % 4) * 0.07;
      this.hitFragments.push({
        mesh,
        material,
        velocity: new Vector3(Math.cos(angle) * speed, force * (0.72 + (i % 5) * 0.1), Math.sin(angle) * speed),
        ttl,
        total: ttl,
        spin: new Vector3(2.5 + (i % 3), 3.2 + (i % 4), 2.1 + (i % 5)),
      });
    }
    while (this.hitFragments.length > 140) this.disposeHitFragment(this.hitFragments.shift());
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
    const mesh = new Mesh(new PlaneGeometry(profile.size, profile.size), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = deterministicAngle(event.toX, event.toZ, event.kind);
    mesh.position.set(event.toX, sampleHeight(this.hf, event.toX, event.toZ) + 0.045, event.toZ);
    mesh.renderOrder = 24;
    this.group.add(mesh);
    this.groundScorches.push({ mesh, texture, material, ttl: profile.ttl, total: profile.ttl, baseOpacity: profile.opacity });
    while (this.groundScorches.length > 90) this.disposeGroundScorch(this.groundScorches.shift());
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

  private makeProjectileMesh(kind: string): Group {
    const group = new Group();
    const missile = isMissile(kind);
    const grenade = kind === 'grenade';
    const shellMaterial = new MeshBasicMaterial({ color: missile ? 0x20262a : grenade ? 0x1c2218 : 0x181814 });
    const noseMaterial = new MeshBasicMaterial({ color: kind === 'aaMissile' ? 0x70d8ff : kind === 'agMissile' ? 0xf2d66c : 0xd07a2a });
    const bandMaterial = new MeshBasicMaterial({ color: trailColor(kind) });
    const glowMaterial = new MeshBasicMaterial({ color: trailColor(kind), transparent: true, opacity: missile ? 0.36 : 0.28, depthWrite: false });
    const body = new Mesh(new CylinderGeometry(missile ? 0.2 : grenade ? 0.3 : 0.34, missile ? 0.24 : grenade ? 0.3 : 0.42, missile ? 1.65 : grenade ? 0.9 : 2.25, 12), shellMaterial);
    const nose = new Mesh(new ConeGeometry(missile ? 0.22 : grenade ? 0.3 : 0.34, missile ? 0.44 : grenade ? 0.26 : 0.72, 12), noseMaterial);
    const band = new Mesh(new CylinderGeometry(missile ? 0.25 : 0.43, missile ? 0.25 : 0.43, 0.1, 12), bandMaterial);
    const glow = new Mesh(new SphereGeometry(missile ? 0.5 : grenade ? 0.45 : 0.78, 12, 8), glowMaterial);
    body.position.y = 0;
    nose.position.y = missile ? 1.04 : grenade ? 0.58 : 1.48;
    band.position.y = missile ? -0.58 : grenade ? -0.32 : -0.75;
    glow.position.y = 0.22;
    group.add(glow, body, nose, band);
    const finCount = missile ? 3 : grenade ? 0 : 4;
    for (let i = 0; i < finCount; i++) {
      const fin = new Mesh(new BoxGeometry(0.08, 0.54, 0.5), shellMaterial.clone());
      fin.position.y = missile ? -0.86 : -1.05;
      const angle = (i / Math.max(1, finCount)) * Math.PI * 2;
      fin.position.x = Math.cos(angle) * (missile ? 0.24 : 0.38);
      fin.position.z = Math.sin(angle) * (missile ? 0.24 : 0.38);
      fin.rotation.y = angle;
      group.add(fin);
    }
    group.scale.setScalar(projectileVisualScale(kind));
    return group;
  }

  private spawnSmallImpact(x: number, y: number, z: number, killed: boolean): void {
    const material = new MeshBasicMaterial({ color: 0xffb449, transparent: true, opacity: 0.72, depthWrite: false });
    const mesh = new Mesh(new SphereGeometry(killed ? 2.6 : 1.3, 10, 6), material);
    const group = new Group();
    group.add(mesh);
    group.position.set(x, y, z);
    group.renderOrder = 49;
    const ttl = killed ? 0.55 : 0.28;
    this.bursts.push({ group, ttl, total: ttl, kind: 'small', materials: [material], baseScale: 1 });
    this.group.add(group);
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
  }

  private spawnHitIndicator(event: CombatEvent): void {
    const texture = makeHitTexture(event);
    const material = new SpriteMaterial({ map: texture, transparent: true, opacity: 1, depthWrite: false, depthTest: false });
    const sprite = new Sprite(material);
    const y = sampleHeight(this.hf, event.toX, event.toZ) + (event.targetType === 'building' ? 8.2 : 5.1);
    sprite.position.set(event.toX, y, event.toZ);
    sprite.scale.set(10.6, 3.9, 1);
    sprite.renderOrder = 95;
    this.group.add(sprite);
    const ttl = event.sourceTeamId === 1 && !this.isVisible(event.toX, event.toZ) ? 3.1 : 1.65;
    this.hitIndicators.push({ sprite, material, texture, ttl, total: ttl, rise: 0.45 });
    while (this.hitIndicators.length > 28) {
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
  return isBombKind(kind) || kind === 'grenade' || kind === 'atRocket' || kind === 'scoutMissile' || kind === 'tankMissile' || kind === 'siegeMissile' || kind === 'agMissile' || kind === 'aaMissile';
}

function isProjectileImpact(kind: string): boolean {
  return isBombImpact(kind) || kind === 'grenade-impact' || kind === 'atRocket-impact' || isTankMissileImpact(kind) || kind === 'agMissile-impact' || kind === 'aaMissile-impact';
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
  return kind === 'agMissile' || kind === 'aaMissile' || kind === 'tankMissile' || kind === 'siegeMissile';
}

function isTankMissileImpact(kind: string): boolean {
  return kind === 'scoutMissile-impact' || kind === 'tankMissile-impact' || kind === 'siegeMissile-impact';
}

function projectileVisualScale(kind: string): number {
  if (kind === 'tankBomb') return 2.25;
  if (kind === 'scoutMissile') return 1.25;
  if (kind === 'tankMissile') return 1.7;
  if (kind === 'siegeMissile') return 2.25;
  if (isMissile(kind)) return 1.6;
  return kind === 'grenade' ? 1.1 : 1.75;
}

function impactBlastScale(kind: string): number {
  if (kind === 'tankBomb-impact') return 1.42;
  if (kind === 'bomb-impact') return 1;
  if (kind === 'grenade-impact') return 0.58;
  if (kind === 'scoutMissile-impact') return 0.52;
  if (kind === 'tankMissile-impact') return 0.72;
  if (kind === 'siegeMissile-impact') return 1;
  return 1;
}

function shouldPaintGroundScorch(hf: Heightfield, event: CombatEvent): boolean {
  if (!isProjectileImpact(event.kind)) return false;
  const groundY = sampleHeight(hf, event.toX, event.toZ);
  const impactY = event.toY ?? groundY;
  return impactY <= groundY + 4.5;
}

function scorchProfile(kind: string, killed: boolean): { size: number; opacity: number; ttl: number } {
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
  if (kind === 'aaMissile') return 0x70d8ff;
  if (kind === 'agMissile') return 0xffd76a;
  if (kind === 'atRocket') return 0xff9e52;
  if (kind === 'grenade') return 0xf2b35e;
  return 0xff8f36;
}
