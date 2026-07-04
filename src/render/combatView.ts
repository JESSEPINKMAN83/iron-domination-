import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { CombatEvent } from '../sim/world';
import { sampleHeight, type Heightfield } from '../sim/heightfield';

interface Tracer {
  line: Line;
  ttl: number;
}

interface Burst {
  mesh: Mesh;
  ttl: number;
}

export class CombatView {
  readonly group = new Group();
  private readonly cannonMaterial = new LineBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.92 });
  private readonly rifleMaterial = new LineBasicMaterial({ color: 0xff8f62, transparent: true, opacity: 0.8 });
  private readonly burstMaterial = new MeshBasicMaterial({ color: 0xffb449, transparent: true, opacity: 0.72, depthWrite: false });
  private readonly tracers: Tracer[] = [];
  private readonly bursts: Burst[] = [];

  constructor(private readonly hf: Heightfield) {}

  push(events: CombatEvent[]): void {
    for (const event of events) {
      const fromY = sampleHeight(this.hf, event.fromX, event.fromZ) + 2.2;
      const toY = sampleHeight(this.hf, event.toX, event.toZ) + 1.4;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([event.fromX, fromY, event.fromZ, event.toX, toY, event.toZ], 3));
      const line = new Line(geometry, event.kind === 'rifle' ? this.rifleMaterial : this.cannonMaterial);
      line.renderOrder = 50;
      this.tracers.push({ line, ttl: event.kind === 'rifle' ? 0.08 : 0.16 });
      this.group.add(line);

      const burst = new Mesh(new SphereGeometry(event.killed ? 2.6 : 1.3, 10, 6), this.burstMaterial);
      burst.position.set(event.toX, toY, event.toZ);
      burst.renderOrder = 49;
      this.bursts.push({ mesh: burst, ttl: event.killed ? 0.55 : 0.28 });
      this.group.add(burst);
    }
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.ttl -= dt;
      const material = tracer.line.material as LineBasicMaterial;
      material.opacity = Math.max(0, tracer.ttl / 0.16);
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
      material.opacity = Math.max(0, burst.ttl / 0.55);
      burst.mesh.scale.multiplyScalar(1 + dt * 2.2);
      if (burst.ttl <= 0) {
        this.group.remove(burst.mesh);
        burst.mesh.geometry.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
