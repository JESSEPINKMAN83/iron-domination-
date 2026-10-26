import type { Entity } from './components';
import { isDesertKind, sampleHeight, type Heightfield } from './heightfield';

export const ROAD_SPEED_BONUS = 1.2;
export const WOODLAND_DETECTION_SCALE = 0.5;
export const TERRAIN_REVEAL_TICKS = 180;

/** Shared with vegetation placement so cover follows the same seeded groves. */
export function woodlandAffinity(kind: Heightfield['kind'], x: number, z: number, seed: number): number {
  const salt = seed * 0.000013;
  const broad = Math.sin(x * 0.013 + salt) * Math.cos(z * 0.016 - salt * 1.7);
  const medium = Math.sin((x + z) * 0.027 - salt * 0.6) * 0.48;
  const fine = Math.cos((x - z) * 0.041 + salt * 2.1) * 0.2;
  if (kind === 'highlands') {
    const raw = 0.5 + broad * 0.42 + medium * 1.12 + fine;
    const groves = Math.max(0, Math.min(1, (raw - 0.3) / 0.52));
    return 0.05 + groves * groves * 0.9;
  }
  const bias = kind === 'natanz' ? -0.24 : kind === 'crater-oasis' ? -0.15 : -0.04;
  return Math.max(0.08, Math.min(0.96, 0.5 + broad * 0.34 + medium + fine + bias));
}

export function terrainCell(hf: Heightfield, x: number, z: number): number {
  const cx = Math.max(0, Math.min(hf.cells - 1, Math.floor((x + hf.size / 2) / hf.cellSize)));
  const cz = Math.max(0, Math.min(hf.cells - 1, Math.floor((z + hf.size / 2) / hf.cellSize)));
  return cz * hf.cells + cx;
}

/** Static, deterministic lookup grids; no vegetation scans or raycasts per unit. */
export function initializeTerrainAdvantages(hf: Heightfield, seed: number): void {
  const roads = new Uint8Array(hf.cells ** 2);
  const woodland = new Uint8Array(roads.length);
  const sight = new Float32Array(roads.length);
  const half = hf.size / 2;
  for (let cz = 0; cz < hf.cells; cz++) for (let cx = 0; cx < hf.cells; cx++) {
    const i = cz * hf.cells + cx;
    const x = (cx + 0.5) * hf.cellSize - half, z = (cz + 0.5) * hf.cellSize - half;
    if (!hf.walkable[i]) continue;
    const h = sampleHeight(hf, x, z);
    const ore = hf.oreFields.some(f => Math.hypot(x - f.x, z - f.z) < f.radius + 6);
    const roadDistance = Math.min(Math.abs(z - hf.size * 0.18 - Math.sin(x / hf.size * 9 + seed % 7) * hf.size * 0.045), Math.abs(x + hf.size * 0.18 - Math.sin(z / hf.size * 8) * hf.size * 0.04));
    roads[i] = !ore && roadDistance < Math.max(4, hf.cellSize * 1.3) ? 1 : 0;
    woodland[i] = !isDesertKind(hf.kind) && !roads[i] && !ore && h > hf.waterLevel + 6.5 && woodlandAffinity(hf.kind, x, z, seed ^ 0x5eed) > 0.72 ? 1 : 0;
    const reach = Math.min(80, hf.size * 0.12);
    const surrounding = (sampleHeight(hf,x-reach,z) + sampleHeight(hf,x+reach,z) + sampleHeight(hf,x,z-reach) + sampleHeight(hf,x,z+reach)) / 4;
    sight[i] = 1 + Math.min(0.25, Math.max(0, h - surrounding - 1) / 24);
  }
  hf.terrainAdvantages = { roads, woodland, sight };
  // Paint the same cells used by movement: dirt routes stay visible in all quality tiers.
  for (let z=0;z<hf.samples;z++) for(let x=0;x<hf.samples;x++) {
    const i=Math.min(z,hf.cells-1)*hf.cells+Math.min(x,hf.cells-1);
    if (!roads[i]) continue;
    const p=(z*hf.samples+x)*4;
    hf.splat[p]=0; hf.splat[p+1]=255; hf.splat[p+2]=0; hf.splat[p+3]=0;
  }
}

export function groundSpeedMultiplier(hf: Heightfield, entity: Entity): number {
  return !entity.flight && hf.terrainAdvantages?.roads[terrainCell(hf,entity.transform.x,entity.transform.z)] ? ROAD_SPEED_BONUS : 1;
}
export function effectiveSight(hf: Heightfield, entity: Entity): number {
  const base = entity.vision?.radius ?? 0;
  return base * (entity.flight || entity.building ? 1 : hf.terrainAdvantages?.sight[terrainCell(hf,entity.transform.x,entity.transform.z)] || 1);
}
export function infantryConcealed(hf: Heightfield, entity: Entity, tick: number): boolean {
  return entity.selectable?.type === 'infantry' && !entity.destroyed && (entity.terrainRevealedUntilTick ?? 0) <= tick && !!hf.terrainAdvantages?.woodland[terrainCell(hf,entity.transform.x,entity.transform.z)];
}
export function canDetectTerrainTarget(hf: Heightfield, observer: Entity, target: Entity, tick: number): boolean {
  if (!infantryConcealed(hf,target,tick)) return true;
  const radius = Math.max(24, effectiveSight(hf,observer) * WOODLAND_DETECTION_SCALE);
  return Math.hypot(target.transform.x-observer.transform.x,target.transform.z-observer.transform.z) <= radius;
}
export function terrainAdvantagesLabel(hf: Heightfield, entity: Entity, tick: number): string {
  if(entity.flight) return '';
  const labels: string[]=[];
  if(groundSpeedMultiplier(hf,entity)>1) labels.push('Road · +20% speed');
  if(infantryConcealed(hf,entity,tick)) labels.push('Woodland · concealed');
  const bonus=Math.round((effectiveSight(hf,entity)/(entity.vision?.radius||1)-1)*100);
  if(bonus>0) labels.push(`High ground · +${bonus}% sight`);
  return labels.join(' · ');
}
