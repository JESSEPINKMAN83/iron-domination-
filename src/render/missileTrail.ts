import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, type Vector3 } from 'three';

/** World-space widths remain readable where WebGL's one-pixel lines disappear. */
export function missileTrailProfile(kind: string): { color: number; width: number; samples: number } {
  if (kind === 'strategicMissile') return { color: 0xff6d38, width: 0.8, samples: 48 };
  if (kind === 'siegeMissile') return { color: 0xff8844, width: 0.52, samples: 28 };
  if (kind === 'aaMissile') return { color: 0xf0f2e9, width: 0.28, samples: 22 };
  if (kind === 'agMissile') return { color: 0xffdf80, width: 0.4, samples: 26 };
  if (kind === 'scoutMissile') return { color: 0x9de2a9, width: 0.23, samples: 18 };
  if (kind === 'rocketPod' || kind === 'atRocket' || kind === 'rocketLauncher') return { color: 0xffa154, width: 0.26, samples: 14 };
  if (kind === 'tankMissile') return { color: 0xffbd58, width: 0.34, samples: 22 };
  if (kind === 'emberDrone') return { color: 0xb5b8a5, width: 0.16, samples: 18 };
  return { color: 0xffedb0, width: 0.12, samples: 10 };
}

export function createMissileTrail(kind: string): Mesh<BufferGeometry, MeshBasicMaterial> {
  const profile = missileTrailProfile(kind);
  const geometry = new BufferGeometry();
  const vertices = (profile.samples - 1) * 12;
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setDrawRange(0, 0);
  const trail = new Mesh(geometry, new MeshBasicMaterial({ color: profile.color, vertexColors: true, transparent: true, opacity: 0.85, blending: AdditiveBlending, side: DoubleSide, forceSinglePass: true, depthWrite: false, toneMapped: false }));
  trail.frustumCulled = false; // Dynamic world-space vertices have no static bounding sphere.
  trail.userData.width = profile.width;
  trail.renderOrder = 58;
  return trail;
}

const TRIANGLE_CORNERS = [0, 1, 2, 2, 1, 3] as const;

/** Two crossed, tapered ribbons in one draw call; no per-frame GPU allocations. */
export function updateMissileTrail(trail: Mesh<BufferGeometry, MeshBasicMaterial>, points: Vector3[]): void {
  const positions = trail.geometry.getAttribute('position') as Float32BufferAttribute;
  const colors = trail.geometry.getAttribute('color') as Float32BufferAttribute;
  const count = Math.min(points.length, positions.count / 12 + 1);
  let vertex = 0;
  for (let i = 1; i < count; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const horizontal = Math.hypot(dx, dz);
    const sideX = horizontal > 0.0001 ? -dz / horizontal : 1;
    const sideZ = horizontal > 0.0001 ? dx / horizontal : 0;
    const length = Math.max(0.0001, Math.hypot(dx, dy, dz));
    for (let plane = 0; plane < 2; plane++) {
      const nx = plane === 0 ? sideX : dy * sideZ / length;
      const ny = plane === 0 ? 0 : (dz * sideX - dx * sideZ) / length;
      const nz = plane === 0 ? sideZ : -dy * sideX / length;
      for (const corner of TRIANGLE_CORNERS) {
        const atEnd = corner >= 2;
        const point = atEnd ? b : a;
        const life = (atEnd ? i : i - 1) / Math.max(1, count - 1);
        const halfWidth = (trail.userData.width as number) * (0.12 + life * 0.88) * 0.5;
        const sign = corner % 2 ? 1 : -1;
        positions.setXYZ(vertex, point.x + nx * halfWidth * sign, point.y + ny * halfWidth * sign, point.z + nz * halfWidth * sign);
        const brightness = life * life;
        colors.setXYZ(vertex++, brightness, brightness, brightness);
      }
    }
  }
  trail.geometry.setDrawRange(0, vertex);
  positions.needsUpdate = colors.needsUpdate = true;
}
