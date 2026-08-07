import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Entity } from '../sim/components';
import { sampleHeight, type Heightfield } from '../sim/heightfield';
import type { VisualQualityTier } from './renderer';

const MAX_TRAIL_SEGMENTS = 1400;
const TRAIL_HOLD_SECONDS = 8;
const TRAIL_FADE_SECONDS = 60;
const TRAIL_LIFETIME_SECONDS = TRAIL_HOLD_SECONDS + TRAIL_FADE_SECONDS;
const FULL_QUALITY_SPACING = 1.05;
const BALANCED_QUALITY_SPACING = 1.65;
const MAX_SEGMENTS_PER_SAMPLE = 3;

interface TrailPoint {
  x: number;
  z: number;
}

interface TrackedVehicle extends TrailPoint {
  seenAt: number;
}

export function trailEmissionCount(distance: number, spacing: number, maxSegments = MAX_SEGMENTS_PER_SAMPLE): number {
  if (!Number.isFinite(distance) || !Number.isFinite(spacing) || distance < spacing || spacing <= 0) return 0;
  return Math.min(maxSegments, Math.max(1, Math.floor(distance / spacing)));
}

function makeTreadTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create tread-mark texture');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255,255,255,0.72)';
  for (const x of [13, 67]) {
    for (let y = -6; y < canvas.height + 12; y += 18) {
      context.save();
      context.translate(x + 8, y + 6);
      context.rotate(-0.12);
      context.fillRect(-8, -5, 16, 10);
      context.restore();
    }
  }

  // A faint compressed strip keeps the trail legible at strategy-camera
  // distance without turning it into two solid black rails.
  const strip = context.createLinearGradient(0, 0, canvas.width, 0);
  strip.addColorStop(0, 'rgba(255,255,255,0)');
  strip.addColorStop(0.13, 'rgba(255,255,255,0.14)');
  strip.addColorStop(0.31, 'rgba(255,255,255,0.04)');
  strip.addColorStop(0.69, 'rgba(255,255,255,0.04)');
  strip.addColorStop(0.87, 'rgba(255,255,255,0.14)');
  strip.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = strip;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function trailColor(kind: Heightfield['kind']): Color {
  if (kind === 'frostbite-pass') return new Color('#6e7f84');
  if (kind === 'crater-oasis') return new Color('#58301d');
  return new Color('#332a1d');
}

function terrainNormal(hf: Heightfield, x: number, z: number, target: Vector3): Vector3 {
  const step = Math.max(0.75, hf.cellSize * 0.45);
  const left = sampleHeight(hf, x - step, z);
  const right = sampleHeight(hf, x + step, z);
  const back = sampleHeight(hf, x, z - step);
  const front = sampleHeight(hf, x, z + step);
  return target.set(left - right, step * 2, back - front).normalize();
}

export class GroundTrailView {
  readonly mesh: InstancedMesh;

  private readonly material: MeshBasicMaterial;
  private readonly births = new Float32Array(MAX_TRAIL_SEGMENTS);
  private readonly tracked = new Map<number, TrackedVehicle>();
  private readonly matrix = new Matrix4();
  private readonly rotation = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly normal = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly color: Color;
  private cursor = 0;
  private count = 0;
  private shader?: { uniforms: Record<string, { value: number }> };

  constructor(
    private readonly hf: Heightfield,
    private readonly isVisible: (x: number, z: number) => boolean,
  ) {
    const geometry = new PlaneGeometry(2.8, 1.8, 1, 1);
    geometry.setAttribute('trailBirth', new InstancedBufferAttribute(this.births, 1).setUsage(DynamicDrawUsage));
    this.material = new MeshBasicMaterial({
      map: makeTreadTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: true,
    });
    this.material.onBeforeCompile = (shader) => {
      this.shader = shader;
      shader.uniforms.uTrailTime = { value: 0 };
      shader.uniforms.uTrailLifetime = { value: TRAIL_LIFETIME_SECONDS };
      shader.uniforms.uTrailFadeStart = { value: TRAIL_HOLD_SECONDS };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float trailBirth;\nvarying float vTrailAge;\nuniform float uTrailTime;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvTrailAge = max(0.0, uTrailTime - trailBirth);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vTrailAge;\nuniform float uTrailLifetime;\nuniform float uTrailFadeStart;',
        )
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\nfloat trailFade = 1.0 - smoothstep(uTrailFadeStart, uTrailLifetime, vTrailAge);\ndiffuseColor.a *= trailFade;\nif (diffuseColor.a < 0.012) discard;',
        );
    };
    this.material.customProgramCacheKey = () => 'iron-dominion-ground-trails-v1';

    this.mesh = new InstancedMesh(geometry, this.material, MAX_TRAIL_SEGMENTS);
    this.mesh.name = 'tank-tread-trails';
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.color = trailColor(hf.kind);
  }

  sample(entities: Iterable<Entity>, timeSeconds: number, quality: VisualQualityTier): void {
    const spacing = quality === 0 ? FULL_QUALITY_SPACING : BALANCED_QUALITY_SPACING;
    const activeIds = new Set<number>();

    for (const entity of entities) {
      if (entity.destroyed || entity.flight || entity.selectable?.type !== 'tank' || !entity.mover) continue;
      const { x, z } = entity.transform;
      activeIds.add(entity.id);
      const tracked = this.tracked.get(entity.id);

      if (quality >= 2 || !this.isVisible(x, z)) {
        this.tracked.set(entity.id, { x, z, seenAt: timeSeconds });
        continue;
      }
      if (!tracked) {
        this.tracked.set(entity.id, { x, z, seenAt: timeSeconds });
        continue;
      }

      const dx = x - tracked.x;
      const dz = z - tracked.z;
      const distance = Math.hypot(dx, dz);
      const emissions = trailEmissionCount(distance, spacing);
      if (emissions === 0) {
        tracked.seenAt = timeSeconds;
        continue;
      }

      const radius = entity.collider?.radius ?? entity.selectable.radius ?? 2.2;
      for (let step = 1; step <= emissions; step++) {
        const t = Math.min(1, (step * spacing) / distance);
        const px = tracked.x + dx * t;
        const pz = tracked.z + dz * t;
        const height = sampleHeight(this.hf, px, pz);
        if (height <= this.hf.waterLevel + 0.18) continue;
        this.emit(px, pz, dx, dz, radius, timeSeconds);
      }
      this.tracked.set(entity.id, { x, z, seenAt: timeSeconds });
    }

    if (this.tracked.size > activeIds.size + 16) {
      for (const [id, tracked] of this.tracked) {
        if (!activeIds.has(id) || timeSeconds - tracked.seenAt > 2) this.tracked.delete(id);
      }
    }
  }

  update(timeSeconds: number, quality: VisualQualityTier): void {
    this.mesh.visible = quality < 2;
    if (this.shader) this.shader.uniforms.uTrailTime.value = timeSeconds;
  }

  private emit(x: number, z: number, dx: number, dz: number, radius: number, timeSeconds: number): void {
    terrainNormal(this.hf, x, z, this.normal);
    this.forward.set(dx, 0, dz).normalize();
    this.forward.addScaledVector(this.normal, -this.forward.dot(this.normal)).normalize();
    this.right.crossVectors(this.forward, this.normal).normalize();
    this.rotation.makeBasis(this.right, this.forward, this.normal);
    this.quaternion.setFromRotationMatrix(this.rotation);

    const widthScale = Math.max(0.72, Math.min(1.55, (radius * 1.55) / 2.8));
    this.scale.set(widthScale, widthScale * 0.92, 1);
    this.position.set(x, sampleHeight(this.hf, x, z) + 0.055, z).addScaledVector(this.normal, 0.035);
    this.matrix.compose(this.position, this.quaternion, this.scale);

    const index = this.cursor;
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.setColorAt(index, this.color);
    this.births[index] = timeSeconds;
    (this.mesh.geometry.getAttribute('trailBirth') as InstancedBufferAttribute).needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.cursor = (this.cursor + 1) % MAX_TRAIL_SEGMENTS;
    this.count = Math.min(MAX_TRAIL_SEGMENTS, this.count + 1);
    this.mesh.count = this.count;
  }
}
