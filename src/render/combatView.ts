import {
  BoxGeometry,
  BufferGeometry,
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

export class CombatView {
  readonly group = new Group();
  private readonly cannonMaterial = new LineBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.92 });
  private readonly rifleMaterial = new LineBasicMaterial({ color: 0xff8f62, transparent: true, opacity: 0.8 });
  private readonly tracers: Tracer[] = [];
  private readonly bursts: Burst[] = [];
  private readonly bombProjectiles: BombProjectile[] = [];
  private readonly up = new Vector3(0, 1, 0);

  constructor(private readonly hf: Heightfield) {}

  push(events: CombatEvent[]): void {
    for (const event of events) {
      const fromY = sampleHeight(this.hf, event.fromX, event.fromZ) + (event.kind === 'bomb' ? 3.1 : 2.2);
      const toY = sampleHeight(this.hf, event.toX, event.toZ) + 1.4;
      if (event.kind === 'bomb') {
        this.spawnBombProjectile(event, fromY, toY);
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
        burst.group.scale.setScalar(1 + age * 2.7);
        for (const material of burst.materials) {
          if (material.userData.role === 'smoke') material.opacity = Math.min(0.42, age * 0.75) * life;
          else if (material.userData.role === 'shock') material.opacity = life * 0.48;
          else material.opacity = life * 0.9;
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
  }

  private spawnBombProjectile(event: CombatEvent, fromY: number, toY: number): void {
    const from = new Vector3(event.fromX, fromY, event.fromZ);
    const to = new Vector3(event.toX, toY, event.toZ);
    const distance = Math.hypot(event.toX - event.fromX, event.toZ - event.fromZ);
    const control = new Vector3((event.fromX + event.toX) / 2, Math.max(fromY, toY) + Math.min(42, distance * 0.34), (event.fromZ + event.toZ) / 2);
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
      duration: Math.min(1.7, Math.max(0.85, distance / 92)),
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
        this.spawnBombBlast(projectile.to.x, projectile.to.y, projectile.to.z, projectile.event.killed);
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
    group.scale.setScalar(2.85);
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
    const fireMaterial = new MeshBasicMaterial({ color: killed ? 0xfff09a : 0xffb347, transparent: true, opacity: 0.9, depthWrite: false });
    const smokeMaterial = new MeshBasicMaterial({ color: 0x292520, transparent: true, opacity: 0.01, depthWrite: false });
    const shockMaterial = new MeshBasicMaterial({ color: 0xffd178, transparent: true, opacity: 0.48, depthWrite: false, side: 2 });
    smokeMaterial.userData.role = 'smoke';
    shockMaterial.userData.role = 'shock';
    fireMaterial.userData.role = 'fire';
    const fireball = new Mesh(new SphereGeometry(killed ? 9.2 : 7.8, 18, 12), fireMaterial);
    const smoke = new Mesh(new SphereGeometry(killed ? 10.4 : 8.8, 12, 8), smokeMaterial);
    const shock = new Mesh(new RingGeometry(5.2, killed ? 16.5 : 14.2, 44), shockMaterial);
    fireball.position.y = 2.2;
    smoke.position.y = 4.2;
    shock.rotation.x = -Math.PI / 2;
    shock.position.y = 0.16;
    group.add(shock, fireball, smoke);
    group.position.set(x, y, z);
    group.renderOrder = 55;
    const ttl = killed ? 1.55 : 1.35;
    this.bursts.push({ group, ttl, total: ttl, kind: 'bomb', materials: [fireMaterial, smokeMaterial, shockMaterial] });
    this.group.add(group);
  }
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
