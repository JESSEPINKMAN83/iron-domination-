import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  PointsMaterial,
} from 'three';
import { mulberry32 } from '../sim/noise';
import type { Heightfield } from '../sim/heightfield';

export class SnowfallView {
  readonly points: Points;
  private readonly positions: Float32Array;
  private readonly speeds: Float32Array;
  private readonly half: number;
  private readonly yMin: number;
  private readonly yMax: number;

  constructor(hf: Heightfield, seed: number, count = 1800) {
    this.half = hf.size / 2;
    this.yMin = hf.waterLevel + 8;
    this.yMax = hf.maxHeight + 92;
    this.positions = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    const rng = mulberry32(seed ^ 0x5f10);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = (rng() * 2 - 1) * this.half;
      this.positions[i * 3 + 1] = this.yMin + rng() * (this.yMax - this.yMin);
      this.positions[i * 3 + 2] = (rng() * 2 - 1) * this.half;
      this.speeds[i] = 5.5 + rng() * 12;
    }

    const geometry = new BufferGeometry();
    const position = new BufferAttribute(this.positions, 3);
    position.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', position);
    const material = new PointsMaterial({
      color: 0xeaf8ff,
      size: 2.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 14;
  }

  update(dt: number, time: number): void {
    const count = this.speeds.length;
    const driftX = Math.sin(time * 0.16) * 2.4;
    const driftZ = Math.cos(time * 0.12) * 1.8;
    for (let i = 0; i < count; i++) {
      const p = i * 3;
      this.positions[p] += driftX * dt;
      this.positions[p + 1] -= this.speeds[i] * dt;
      this.positions[p + 2] += driftZ * dt;
      if (this.positions[p + 1] < this.yMin) this.positions[p + 1] = this.yMax;
      if (this.positions[p] > this.half) this.positions[p] = -this.half;
      if (this.positions[p] < -this.half) this.positions[p] = this.half;
      if (this.positions[p + 2] > this.half) this.positions[p + 2] = -this.half;
      if (this.positions[p + 2] < -this.half) this.positions[p + 2] = this.half;
    }
    const attr = this.points.geometry.getAttribute('position') as BufferAttribute;
    attr.needsUpdate = true;
  }
}
