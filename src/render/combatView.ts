import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { CombatEvent } from '../sim/world';
import { sampleHeight, type Heightfield } from '../sim/heightfield';

interface Tracer {
  line: Line;
  ttl: number;
  total: number;
}

interface Burst {
  mesh: Mesh;
  ttl: number;
  total: number;
}

export class CombatView {
  readonly group = new Group();
  private readonly cannonMaterial = new LineBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.92 });
  private readonly bombMaterial = new LineBasicMaterial({ color: 0xff6a34, transparent: true, opacity: 0.96 });
  private readonly rifleMaterial = new LineBasicMaterial({ color: 0xff8f62, transparent: true, opacity: 0.8 });
  private readonly burstMaterial = new MeshBasicMaterial({ color: 0xffb449, transparent: true, opacity: 0.72, depthWrite: false });
  private readonly tracers: Tracer[] = [];
  private readonly bursts: Burst[] = [];

  constructor(private readonly hf: Heightfield) {}

  push(events: CombatEvent[]): void {
    for (const event of events) {
      const fromY = sampleHeight(this.hf, event.fromX, event.fromZ) + (event.kind === 'bomb' ? 3.1 : 2.2);
      const toY = sampleHeight(this.hf, event.toX, event.toZ) + 1.4;
      const geometry = new BufferGeometry();
      if (event.kind === 'bomb') {
        const midX = (event.fromX + event.toX) / 2;
        const midZ = (event.fromZ + event.toZ) / 2;
        const arcY = Math.max(fromY, toY) + Math.min(36, Math.hypot(event.toX - event.fromX, event.toZ - event.fromZ) * 0.32);
        geometry.setAttribute('position', new Float32BufferAttribute([event.fromX, fromY, event.fromZ, midX, arcY, midZ, event.toX, toY, event.toZ], 3));
      } else {
        geometry.setAttribute('position', new Float32BufferAttribute([event.fromX, fromY, event.fromZ, event.toX, toY, event.toZ], 3));
      }
      const line = new Line(geometry, event.kind === 'rifle' ? this.rifleMaterial : event.kind === 'bomb' ? this.bombMaterial : this.cannonMaterial);
      line.renderOrder = 50;
      const tracerTtl = event.kind === 'rifle' ? 0.08 : event.kind === 'bomb' ? 0.44 : 0.16;
      this.tracers.push({ line, ttl: tracerTtl, total: tracerTtl });
      this.group.add(line);

      const burstRadius = event.kind === 'bomb' ? (event.killed ? 5.2 : 3.6) : event.killed ? 2.6 : 1.3;
      const burst = new Mesh(new SphereGeometry(burstRadius, 10, 6), this.burstMaterial);
      burst.position.set(event.toX, toY, event.toZ);
      burst.renderOrder = 49;
      const burstTtl = event.kind === 'bomb' ? 0.8 : event.killed ? 0.55 : 0.28;
      this.bursts.push({ mesh: burst, ttl: burstTtl, total: burstTtl });
      this.group.add(burst);
    }
  }

  update(dt: number): void {
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
      const material = burst.mesh.material as MeshBasicMaterial;
      material.opacity = Math.max(0, burst.ttl / burst.total) * 0.72;
      burst.mesh.scale.multiplyScalar(1 + dt * 2.2);
      if (burst.ttl <= 0) {
        this.group.remove(burst.mesh);
        burst.mesh.geometry.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
