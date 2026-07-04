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
}

interface HitIndicator {
  sprite: Sprite;
  material: SpriteMaterial;
  texture: CanvasTexture;
  ttl: number;
  total: number;
  rise: number;
}

export class CombatView {
  readonly group = new Group();
  private readonly cannonMaterial = new LineBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.92 });
  private readonly rifleMaterial = new LineBasicMaterial({ color: 0xff8f62, transparent: true, opacity: 0.8 });
  private readonly tracers: Tracer[] = [];
  private readonly bursts: Burst[] = [];
  private readonly bombProjectiles: BombProjectile[] = [];
  private readonly hitIndicators: HitIndicator[] = [];
  private readonly up = new Vector3(0, 1, 0);

  constructor(
    private readonly hf: Heightfield,
    private readonly isVisible: (x: number, z: number) => boolean = () => true,
  ) {}

  push(events: CombatEvent[]): void {
    for (const event of events) {
      const sourceVisible = this.isVisible(event.fromX, event.fromZ);
      const impactVisible = this.isVisible(event.toX, event.toZ);
      const playerHiddenHit = event.sourceTeamId === 1 && event.damage > 0;
      // fights entirely inside the fog stay hidden, except brief player-fired hit confirmations
      if (!sourceVisible && !impactVisible && !playerHiddenHit) continue;
      const muzzleHeight = event.kind === 'bomb' ? 3.1 : event.kind === 'rifle' ? 1.35 : 2.2;
      const fromY = event.fromY ?? sampleHeight(this.hf, event.fromX, event.fromZ) + muzzleHeight;
      const toY = event.toY ?? sampleHeight(this.hf, event.toX, event.toZ) + 1.4;
      if (event.kind === 'bomb') {
        this.spawnBombProjectile(event, fromY, toY);
        continue;
      }
      if (event.kind === 'bomb-impact') {
        this.spawnBombBlast(event.toX, sampleHeight(this.hf, event.toX, event.toZ) + 0.4, event.toZ, event.killed);
        if (event.damage > 0 || event.killed) this.spawnHitIndicator(event);
        continue;
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([event.fromX, fromY, event.fromZ, event.toX, toY, event.toZ], 3));
      const line = new Line(geometry, event.kind === 'rifle' ? this.rifleMaterial : this.cannonMaterial);
      line.renderOrder = 50;
      const tracerTtl = event.kind === 'rifle' ? 0.08 : 0.16;
      this.tracers.push({ line, ttl: tracerTtl, total: tracerTtl });
      this.group.add(line);

      this.spawnSmallImpact(event.toX, toY, event.toZ, event.killed);
      if (event.damage > 0 || event.killed) this.spawnHitIndicator(event);
    }
  }

  update(dt: number): void {
    this.updateBombProjectiles(dt);
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
        burst.group.scale.setScalar(1 + age * 1.28);
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
    const control = new Vector3((event.fromX + event.toX) / 2, Math.max(fromY, toY) + Math.min(84, distance * 0.28), (event.fromZ + event.toZ) / 2);
    const group = this.makeBombMesh();
    group.position.copy(from);
    group.renderOrder = 60;
    this.group.add(group);

    const trailGeometry = new BufferGeometry();
    trailGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(8 * 3), 3));
    const trail = new Line(trailGeometry, new LineBasicMaterial({ color: 0xff8f36, transparent: true, opacity: 0.5 }));
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

  private makeBombMesh(): Group {
    const group = new Group();
    const shellMaterial = new MeshBasicMaterial({ color: 0x181814 });
    const noseMaterial = new MeshBasicMaterial({ color: 0xd07a2a });
    const bandMaterial = new MeshBasicMaterial({ color: 0xffb33f });
    const glowMaterial = new MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.28, depthWrite: false });
    const body = new Mesh(new CylinderGeometry(0.34, 0.42, 2.25, 12), shellMaterial);
    const nose = new Mesh(new ConeGeometry(0.34, 0.72, 12), noseMaterial);
    const band = new Mesh(new CylinderGeometry(0.43, 0.43, 0.1, 12), bandMaterial);
    const glow = new Mesh(new SphereGeometry(0.78, 12, 8), glowMaterial);
    body.position.y = 0;
    nose.position.y = 1.48;
    band.position.y = -0.75;
    glow.position.y = 0.22;
    group.add(glow, body, nose, band);
    for (let i = 0; i < 4; i++) {
      const fin = new Mesh(new BoxGeometry(0.08, 0.54, 0.5), shellMaterial.clone());
      fin.position.y = -1.05;
      fin.position.x = i < 2 ? (i === 0 ? 0.38 : -0.38) : 0;
      fin.position.z = i >= 2 ? (i === 2 ? 0.38 : -0.38) : 0;
      fin.rotation.y = i >= 2 ? Math.PI / 2 : 0;
      group.add(fin);
    }
    group.scale.setScalar(1.75);
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
    this.bursts.push({ group, ttl, total: ttl, kind: 'small', materials: [material] });
    this.group.add(group);
  }

  private spawnBombBlast(x: number, y: number, z: number, killed: boolean): void {
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
    this.bursts.push({ group, ttl, total: ttl, kind: 'bomb', materials: [fireMaterial, smokeMaterial, shockMaterial, scorchMaterial, debrisMaterial] });
    this.group.add(group);
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
