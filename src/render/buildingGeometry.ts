import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, MeshStandardMaterial,
  PlaneGeometry, RingGeometry, TorusGeometry, type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SHARED = 'ironDominionSharedBuilding';
const geometryCache = new Map<string, BufferGeometry>();
const materialCache = new Map<string, MeshStandardMaterial>();

export function markSharedBuilding<T extends { userData: Record<string, unknown> }>(resource: T): T {
  resource.userData[SHARED] = true;
  return resource;
}

export function isSharedBuildingResource(resource: { userData?: Record<string, unknown> } | undefined): boolean {
  return resource?.userData?.[SHARED] === true;
}

export function sharedBuildingGeometry(key: string, build: () => BufferGeometry): BufferGeometry {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = markSharedBuilding(build());
    geometryCache.set(key, geometry);
  }
  return geometry;
}

export function buildingBoxGeometry(w: number, h: number, d: number): BufferGeometry {
  // Tiny bevels are invisible at RTS distance and cost ~10x the triangles of a box.
  if (Math.min(w, h, d) < 0.45) {
    return sharedBuildingGeometry(`box:${w}:${h}:${d}`, () => new BoxGeometry(w, h, d));
  }
  const radius = Math.min(0.16, w * 0.07, h * 0.12, d * 0.07);
  return sharedBuildingGeometry(`round:${w}:${h}:${d}:${radius}`, () => new RoundedBoxGeometry(w, h, d, 1, radius));
}

export function buildingCylinderGeometry(rt: number, rb: number, h: number, segments = 8): BufferGeometry {
  return sharedBuildingGeometry(`cyl:${rt}:${rb}:${h}:${segments}`, () => new CylinderGeometry(rt, rb, h, segments));
}

export function buildingConeGeometry(r: number, h: number, segments = 8): BufferGeometry {
  return sharedBuildingGeometry(`cone:${r}:${h}:${segments}`, () => new ConeGeometry(r, h, segments));
}

export function buildingTorusGeometry(r: number, tube: number, radial = 5, tubular = 12, arc?: number): BufferGeometry {
  return sharedBuildingGeometry(
    `torus:${r}:${tube}:${radial}:${tubular}:${arc ?? 'full'}`,
    () => (arc === undefined ? new TorusGeometry(r, tube, radial, tubular) : new TorusGeometry(r, tube, radial, tubular, arc)),
  );
}

export function buildingRingGeometry(inner: number, outer: number, segments = 16): BufferGeometry {
  return sharedBuildingGeometry(`ring:${inner}:${outer}:${segments}`, () => new RingGeometry(inner, outer, segments));
}

export function buildingPlaneGeometry(w: number, h: number): BufferGeometry {
  return sharedBuildingGeometry(`plane:${w}:${h}`, () => new PlaneGeometry(w, h));
}

/** Only large structural pieces belong in cascaded shadow maps. */
export function shouldCastBuildingShadow(w: number, h: number, d: number): boolean {
  return w * h * d >= 0.85 && Math.min(w, h, d) >= 0.22;
}

export function shouldCastCylindricalShadow(radius: number, height: number): boolean {
  return radius >= 0.18 && radius * radius * Math.abs(height) >= 0.12;
}

export function sharedBuildingMaterial(key: string, build: () => MeshStandardMaterial): MeshStandardMaterial {
  let material = materialCache.get(key);
  if (!material) {
    material = markSharedBuilding(build());
    materialCache.set(key, material);
  }
  return material;
}

export function skipSharedBuildingDispose(material: Material): boolean {
  if (isSharedBuildingResource(material)) return true;
  const map = (material as MeshStandardMaterial).map;
  return !!map && isSharedBuildingResource(map);
}
