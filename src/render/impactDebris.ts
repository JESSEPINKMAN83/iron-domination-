import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, MeshBasicMaterial, Object3D } from 'three';

interface Chip {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; lifetime: number; size: number; spin: number; seed: number;
  ground: number; masonry: boolean; soft: boolean; spark: boolean; bounced: boolean;
}
export interface DebrisEmission {
  x: number; y: number; z: number; ground: number; angle: number; speed: number;
  lift: number; size: number; lifetime: number; seed: number; masonry: boolean; soft?: boolean; spark: boolean;
}
/** Fixed-capacity, one-draw pool. Sparks cool into solid chips; masonry stays dusty. */
export class ImpactDebrisView {
  readonly mesh: InstancedMesh;
  private readonly particles: Chip[];
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private active = 0;
  private cursor = 0;
  private budget: number;
  constructor(readonly capacity = 140) {
    this.budget = capacity;
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), capacity);
    this.mesh.name = 'instanced-impact-debris';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color);
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.particles = Array.from({ length: capacity }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, lifetime: 0, size: 0, spin: 0, seed: 0, ground: 0, masonry: false, soft: false, spark: false, bounced: false }));
  }
  get count(): number { return this.active; }
  emit(event: DebrisEmission): void {
    if (this.budget <= 0) return;
    const index = this.active < this.budget ? this.active++ : this.cursor++ % this.budget;
    const p = this.particles[index];
    Object.assign(p, { x: event.x, y: event.y, z: event.z, vx: Math.cos(event.angle) * event.speed, vz: Math.sin(event.angle) * event.speed,
      vy: event.lift, age: 0, lifetime: event.lifetime, size: event.size, spin: 2.5 + event.seed % 4, seed: event.seed,
      ground: event.ground, masonry: event.masonry, soft: event.soft ?? false, spark: event.spark, bounced: false });
  }
  limit(max: number): void { this.budget = Math.max(0, Math.min(this.capacity, max)); this.active = Math.min(this.active, this.budget); this.mesh.count = this.active; }
  update(dt: number): void {
    for (let i = this.active - 1; i >= 0; i--) {
      const p = this.particles[i]; p.age += dt;
      if (p.age >= p.lifetime) { const last = this.particles[--this.active]; this.particles[this.active] = p; this.particles[i] = last; continue; }
      p.vy -= 18 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.ground + p.size * 0.25) {
        p.y = p.ground + p.size * 0.25;
        p.vy = p.bounced ? 0 : Math.abs(p.vy) * 0.22;
        p.vx *= 0.42; p.vz *= 0.42; p.bounced = true;
      }
      const life = 1 - p.age / p.lifetime;
      const shrink = Math.min(1, life * 4);
      this.transform.position.set(p.x, p.y, p.z);
      this.transform.rotation.set(p.age * p.spin, p.seed + p.age * p.spin * 0.8, p.age * p.spin * 1.1);
      this.transform.scale.set(p.size * shrink, p.size * (p.spark ? 0.25 : p.masonry ? 0.7 : 0.3) * shrink, p.size * (p.masonry ? 0.8 : 0.5) * shrink);
      this.transform.updateMatrix(); this.mesh.setMatrixAt(i, this.transform.matrix);
      const heat = p.spark && !p.masonry ? Math.max(0, 1 - p.age / 0.22) : 0;
      this.color.setHex(p.soft ? 0x64634b : p.masonry ? (p.seed % 2 ? 0x9c9382 : 0x6d716d) : p.seed % 2 ? 0x42494d : 0x77766c);
      if (heat > 0) this.color.setRGB(this.color.r + heat * 0.8, this.color.g + heat * 0.4, this.color.b * (1 - heat * 0.7));
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.count = this.active;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); this.mesh.geometry.dispose(); (this.mesh.material as MeshBasicMaterial).dispose(); }
}
