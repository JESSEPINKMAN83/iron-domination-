import type { Entity, StructureDamage } from './components';

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const FIRST_HIT_VISIBLE_FLOOR = 42;

export function createStructureDamage(entity: Entity): StructureDamage {
  const footprint = entity.building?.footprint ?? { w: 4, h: 4 };
  const cols = clamp(Math.round(footprint.w / 2), 3, 4);
  const rows = clamp(Math.round(footprint.h / 2), 3, 4);
  const tiers = Math.max(2, footprint.w >= 8 || footprint.h >= 8 ? 2 : 2);
  return { cols, rows, tiers, cells: new Uint8Array(cols * rows * tiers), version: 0 };
}

export interface StructureDamageHit {
  hitX: number;
  hitZ: number;
  hitY?: number;
  fromX: number;
  fromZ: number;
  amount: number;
  splashRadius: number;
  trajectory?: 'arc' | 'drop' | 'flat';
  cellSize?: number;
}

export function applyStructureDamage(entity: Entity, hit: StructureDamageHit): boolean {
  if (!entity.building || hit.amount <= 0) return false;
  entity.structureDamage ??= createStructureDamage(entity);
  const damage = entity.structureDamage;
  const cellSize = hit.cellSize ?? 2;
  const halfW = entity.building.footprint.w * cellSize;
  const halfH = entity.building.footprint.h * cellSize;
  const local = worldToBuildingLocal(entity, hit.hitX, hit.hitZ);
  const outside = Math.abs(local.x) > halfW || Math.abs(local.z) > halfH;
  let hitLocalX = clamp(local.x, -halfW, halfW);
  let hitLocalZ = clamp(local.z, -halfH, halfH);

  const centerDirectHit = (hit.trajectory === undefined || hit.trajectory === 'flat') && nearCenter(local.x, halfW, local.z, halfH);
  if (outside || centerDirectHit) {
    const from = worldToBuildingLocal(entity, hit.fromX, hit.fromZ);
    const xWeight = Math.abs(from.x) / Math.max(1, halfW);
    const zWeight = Math.abs(from.z) / Math.max(1, halfH);
    if (xWeight >= zWeight) {
      hitLocalX = from.x < 0 ? -halfW : halfW;
      hitLocalZ = clamp(local.z, -halfH, halfH);
    } else {
      hitLocalZ = from.z < 0 ? -halfH : halfH;
      hitLocalX = clamp(local.x, -halfW, halfW);
    }
  }

  const tier = tierForHit(entity, hit);
  const cellW = (halfW * 2) / damage.cols;
  const cellH = (halfH * 2) / damage.rows;
  const splash = Math.max(Math.max(cellW, cellH) * 1.2, hit.splashRadius);
  const scaledAmount = hit.amount * 4.8;
  let changed = false;

  for (let t = 0; t < damage.tiers; t++) {
    const tierFalloff = t === tier ? 1 : 0.34 / (Math.abs(t - tier) + 1);
    for (let row = 0; row < damage.rows; row++) {
      for (let col = 0; col < damage.cols; col++) {
        const cx = -halfW + cellW * (col + 0.5);
        const cz = -halfH + cellH * (row + 0.5);
        const d = Math.hypot(cx - hitLocalX, cz - hitLocalZ);
        if (d > splash) continue;
        const radial = 1 - d / splash;
        const delta = Math.max(1, Math.round(scaledAmount * radial * tierFalloff));
        changed = addCellDamage(damage, col, row, t, delta) || changed;
      }
    }
  }

  const nearestCol = clamp(Math.floor((hitLocalX + halfW) / cellW), 0, damage.cols - 1);
  const nearestRow = clamp(Math.floor((hitLocalZ + halfH) / cellH), 0, damage.rows - 1);
  const directIndex = cellIndex(damage, nearestCol, nearestRow, tier);
  if (damage.cells[directIndex] < FIRST_HIT_VISIBLE_FLOOR) {
    changed = addCellDamage(damage, nearestCol, nearestRow, tier, FIRST_HIT_VISIBLE_FLOOR - damage.cells[directIndex]) || changed;
  }

  if (changed) damage.version++;
  return changed;
}

export function cellIndex(damage: StructureDamage, col: number, row: number, tier: number): number {
  return tier * damage.cols * damage.rows + row * damage.cols + col;
}

function addCellDamage(damage: StructureDamage, col: number, row: number, tier: number, amount: number): boolean {
  const index = cellIndex(damage, col, row, tier);
  const before = damage.cells[index];
  const after = Math.min(255, before + amount);
  damage.cells[index] = after;
  let changed = after !== before;
  if (after >= 200 && tier + 1 < damage.tiers) {
    const above = cellIndex(damage, col, row, tier + 1);
    const bleedBefore = damage.cells[above];
    damage.cells[above] = Math.min(255, bleedBefore + Math.max(1, Math.round(amount * 0.25)));
    changed ||= damage.cells[above] !== bleedBefore;
  }
  return changed;
}

function tierForHit(entity: Entity, hit: StructureDamageHit): number {
  const damage = entity.structureDamage ?? createStructureDamage(entity);
  if (hit.trajectory === 'arc' || hit.trajectory === 'drop') return damage.tiers - 1;
  if (hit.hitY === undefined) return 0;
  const height = 3.2;
  const baseY = entity.transform.y ?? 0;
  const t = clamp((hit.hitY - baseY) / height, 0, 0.999);
  return clamp(Math.floor(t * damage.tiers), 0, damage.tiers - 1);
}

function worldToBuildingLocal(entity: Entity, x: number, z: number): { x: number; z: number } {
  const dx = x - entity.transform.x;
  const dz = z - entity.transform.z;
  const rot = -(entity.transform.rot ?? 0);
  const s = Math.sin(rot);
  const c = Math.cos(rot);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function nearCenter(x: number, halfW: number, z: number, halfH: number): boolean {
  return Math.abs(x) < halfW * 0.08 && Math.abs(z) < halfH * 0.08;
}
