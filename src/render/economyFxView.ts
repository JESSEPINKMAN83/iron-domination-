import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import type { CombatEvent, GameSim } from '../sim/world';

interface FloatParticle {
  sprite: Sprite;
  material: SpriteMaterial;
  texture?: CanvasTexture;
  velocity: Vector3;
  ttl: number;
  total: number;
  spin: number;
  baseScale: number;
}

interface WorkDust {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  velocity: Vector3;
  ttl: number;
  total: number;
  spin: number;
}

interface HarvesterEmitter {
  dustTimer: number;
  moneyTimer: number;
}

const coinTexture = makeCoinTexture();
const dollarTexture = makeDollarTexture();

export class EconomyFxView {
  readonly group = new Group();
  private readonly emitters = new Map<number, HarvesterEmitter>();
  private readonly particles: FloatParticle[] = [];
  private readonly dust: WorkDust[] = [];
  private readonly coinMaterial = new SpriteMaterial({
    map: coinTexture,
    color: 0xffdc6a,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly dustMaterial = new MeshBasicMaterial({
    color: 0xf0d56a,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: AdditiveBlending,
    side: 2,
  });

  constructor(
    private readonly sim: GameSim,
    private readonly hf: Heightfield,
    private readonly isVisible: (x: number, z: number) => boolean = () => true,
  ) {}

  push(events: CombatEvent[]): void {
    for (const event of events) {
      if (event.kind !== 'ore-delivery') continue;
      if (!this.isVisible(event.toX, event.toZ) && event.sourceTeamId !== 1) continue;
      this.spawnDelivery(event);
    }
  }

  update(dt: number): void {
    this.updateHarvesters(dt);
    this.updateParticles(dt);
    this.updateDust(dt);
  }

  private updateHarvesters(dt: number): void {
    const activeIds = new Set<number>();
    for (const entity of this.sim.world.entities) {
      if (!entity.harvester || !entity.cargo || entity.destroyed || entity.harvester.state !== 'gathering') continue;
      if (!this.isVisible(entity.transform.x, entity.transform.z)) continue;
      activeIds.add(entity.id);
      const emitter = this.emitters.get(entity.id) ?? { dustTimer: 0, moneyTimer: 0 };
      emitter.dustTimer -= dt;
      emitter.moneyTimer -= dt;
      if (emitter.dustTimer <= 0) {
        emitter.dustTimer = 0.055 + seeded01(entity.id, this.sim.tick, 11) * 0.045;
        this.spawnWorkDust(entity);
      }
      if (emitter.moneyTimer <= 0) {
        emitter.moneyTimer = 0.42 + seeded01(entity.id, this.sim.tick, 23) * 0.22;
        this.spawnFloatingMoney(entity);
      }
      this.emitters.set(entity.id, emitter);
    }
    for (const id of Array.from(this.emitters.keys())) {
      if (!activeIds.has(id)) this.emitters.delete(id);
    }
  }

  private spawnWorkDust(entity: Entity): void {
    const angle = seeded01(entity.id, this.sim.tick, 41) * Math.PI * 2;
    const radius = 0.6 + seeded01(this.sim.tick, entity.id, 47) * 2.2;
    const x = entity.transform.x + Math.cos(angle) * radius;
    const z = entity.transform.z + Math.sin(angle) * radius;
    const y = sampleHeight(this.hf, x, z) + 0.35 + seeded01(entity.id, this.sim.tick, 53) * 1.0;
    const material = this.dustMaterial.clone();
    material.opacity = 0.2 + seeded01(entity.id, this.sim.tick, 59) * 0.28;
    const mesh = new Mesh(new PlaneGeometry(0.45, 0.45), material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = -Math.PI / 2 + seeded01(entity.id, this.sim.tick, 61) * 0.3;
    mesh.rotation.z = angle;
    mesh.renderOrder = 61;
    this.group.add(mesh);
    this.dust.push({
      mesh,
      velocity: new Vector3(Math.cos(angle) * 0.25, 0.9 + seeded01(entity.id, this.sim.tick, 67) * 0.75, Math.sin(angle) * 0.25),
      ttl: 0.75,
      total: 0.75,
      spin: -1.2 + seeded01(entity.id, this.sim.tick, 71) * 2.4,
    });
    while (this.dust.length > 90) this.disposeDust(this.dust.shift());
  }

  private spawnFloatingMoney(entity: Entity): void {
    const angle = seeded01(entity.id, this.sim.tick, 83) * Math.PI * 2;
    const x = entity.transform.x + Math.cos(angle) * 1.4;
    const z = entity.transform.z + Math.sin(angle) * 1.4;
    const y = (entity.transform.y ?? sampleHeight(this.hf, x, z)) + 2.2;
    const material = new SpriteMaterial({
      map: dollarTexture,
      color: 0xb8ff92,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const sprite = new Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(1.05);
    sprite.renderOrder = 92;
    this.group.add(sprite);
    this.particles.push({
      sprite,
      material,
      velocity: new Vector3(Math.cos(angle) * 0.38, 1.08, Math.sin(angle) * 0.38),
      ttl: 1.15,
      total: 1.15,
      spin: -1.4 + seeded01(entity.id, this.sim.tick, 89) * 2.8,
      baseScale: 1.05,
    });
    while (this.particles.length > 64) this.disposeParticle(this.particles.shift());
  }

  private spawnDelivery(event: CombatEvent): void {
    const amount = Math.max(0, Math.round(event.damage));
    if (amount <= 0) return;
    const texture = makeDeliveryTexture(amount);
    const material = new SpriteMaterial({ map: texture, transparent: true, opacity: 1, depthWrite: false, depthTest: false });
    const sprite = new Sprite(material);
    const y = (event.toY ?? sampleHeight(this.hf, event.toX, event.toZ)) + 8.2;
    sprite.position.set(event.toX, y, event.toZ);
    sprite.scale.set(9.8, 3.3, 1);
    sprite.renderOrder = 98;
    this.group.add(sprite);
    this.particles.push({
      sprite,
      material,
      texture,
      velocity: new Vector3(0, 1.1, 0),
      ttl: 2.1,
      total: 2.1,
      spin: 0,
      baseScale: 1,
    });

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + seeded01(amount, i, 97) * 0.25;
      const coinMaterial = this.coinMaterial.clone();
      const coin = new Sprite(coinMaterial);
      coin.position.set(event.toX + Math.cos(angle) * 1.4, y - 1.2 + (i % 3) * 0.2, event.toZ + Math.sin(angle) * 1.4);
      coin.scale.setScalar(0.8 + (i % 3) * 0.12);
      coin.renderOrder = 94;
      this.group.add(coin);
      this.particles.push({
        sprite: coin,
        material: coinMaterial,
        velocity: new Vector3(Math.cos(angle) * 1.25, 1.65 + (i % 3) * 0.18, Math.sin(angle) * 1.25),
        ttl: 1.2,
        total: 1.2,
        spin: i % 2 ? 2.4 : -2.1,
        baseScale: coin.scale.x,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.ttl -= dt;
      const life = Math.max(0, particle.ttl / particle.total);
      const age = 1 - life;
      particle.sprite.position.addScaledVector(particle.velocity, dt);
      particle.material.rotation += particle.spin * dt;
      const pop = 1 + Math.sin(Math.min(1, age * 2.8) * Math.PI) * 0.1;
      particle.sprite.scale.setScalar(particle.baseScale * pop);
      particle.material.opacity = Math.min(1, life * 1.8);
      if (particle.ttl <= 0) {
        this.disposeParticle(particle);
        this.particles.splice(i, 1);
      }
    }
  }

  private updateDust(dt: number): void {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const dust = this.dust[i];
      dust.ttl -= dt;
      const life = Math.max(0, dust.ttl / dust.total);
      const age = 1 - life;
      dust.mesh.position.addScaledVector(dust.velocity, dt);
      dust.mesh.rotation.z += dust.spin * dt;
      dust.mesh.scale.setScalar(1 + age * 2.4);
      dust.mesh.material.opacity = 0.34 * life * life;
      if (dust.ttl <= 0) {
        this.disposeDust(dust);
        this.dust.splice(i, 1);
      }
    }
  }

  private disposeParticle(particle?: FloatParticle): void {
    if (!particle) return;
    this.group.remove(particle.sprite);
    particle.texture?.dispose();
    particle.material.dispose();
  }

  private disposeDust(dust?: WorkDust): void {
    if (!dust) return;
    this.group.remove(dust.mesh);
    dust.mesh.geometry.dispose();
    dust.mesh.material.dispose();
  }
}

function makeCoinTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.clearRect(0, 0, 96, 96);
  ctx.shadowColor = 'rgba(255, 220, 106, .9)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = 'rgba(240, 213, 106, .95)';
  ctx.beginPath();
  ctx.arc(48, 48, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(82, 61, 19, .8)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.font = '700 34px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4f3812';
  ctx.fillText('$', 48, 49);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeDollarTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.clearRect(0, 0, 96, 96);
  ctx.font = '700 54px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(125, 242, 125, .95)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#b8ff92';
  ctx.fillText('$', 48, 49);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeDeliveryTexture(amount: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(5, 8, 7, .78)';
  roundRect(ctx, 14, 18, 292, 74, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(240, 213, 106, .96)';
  ctx.lineWidth = 3;
  roundRect(ctx, 14, 18, 292, 74, 10);
  ctx.stroke();
  ctx.font = '700 34px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#f0d56a';
  ctx.shadowColor = 'rgba(240, 213, 106, .5)';
  ctx.shadowBlur = 10;
  ctx.fillText(`+$${amount}`, 30, 56);
  ctx.shadowBlur = 0;
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#dce8df';
  ctx.fillText('ORE DELIVERED', 32, 78);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function seeded01(a: number, b: number, c: number): number {
  let x = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff;
}
