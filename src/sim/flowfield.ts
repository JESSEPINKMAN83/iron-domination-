import type { Heightfield } from './heightfield';

export interface Cell {
  x: number;
  y: number;
}

export interface BlockedFootprint {
  x: number;
  z: number;
  radius: number;
}

interface DynamicBlocker extends BlockedFootprint {
  id: number;
}

export class NavigationGrid {
  readonly cells: number;
  readonly cellSize: number;
  readonly size: number;
  readonly blocked: Uint8Array;
  private readonly baseBlocked: Uint8Array;
  private readonly dynamicBlockers = new Map<number, DynamicBlocker>();

  constructor(hf: Heightfield, footprints: BlockedFootprint[] = []) {
    this.cells = hf.cells;
    this.cellSize = hf.cellSize;
    this.size = hf.size;
    this.blocked = new Uint8Array(hf.walkable.length);
    for (let i = 0; i < hf.walkable.length; i++) this.blocked[i] = hf.walkable[i] ? 0 : 1;
    this.baseBlocked = new Uint8Array(this.blocked);
    for (const f of footprints) this.blockCircle(f.x, f.z, f.radius);
    this.baseBlocked.set(this.blocked);
  }

  index(cx: number, cy: number): number {
    return cy * this.cells + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cells && cy < this.cells;
  }

  isWalkableCell(cx: number, cy: number): boolean {
    return this.inBounds(cx, cy) && this.blocked[this.index(cx, cy)] === 0;
  }

  worldToCell(x: number, z: number): Cell {
    const half = this.size / 2;
    return {
      x: Math.min(this.cells - 1, Math.max(0, Math.floor((x + half) / this.cellSize))),
      y: Math.min(this.cells - 1, Math.max(0, Math.floor((z + half) / this.cellSize))),
    };
  }

  cellCenter(cx: number, cy: number): { x: number; z: number } {
    const half = this.size / 2;
    return { x: (cx + 0.5) * this.cellSize - half, z: (cy + 0.5) * this.cellSize - half };
  }

  nearestWalkableCell(x: number, z: number, maxRadius = 48): Cell | undefined {
    const start = this.worldToCell(x, z);
    if (this.isWalkableCell(start.x, start.y)) return start;
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = start.x + dx;
          const cy = start.y + dy;
          if (this.isWalkableCell(cx, cy)) return { x: cx, y: cy };
        }
      }
    }
    return undefined;
  }

  setDynamicBlocker(id: number, x: number, z: number, radius: number): void {
    this.dynamicBlockers.set(id, { id, x, z, radius });
    this.rebuildBlocked();
  }

  removeDynamicBlocker(id: number): void {
    if (!this.dynamicBlockers.delete(id)) return;
    this.rebuildBlocked();
  }

  private rebuildBlocked(): void {
    this.blocked.set(this.baseBlocked);
    for (const blocker of this.dynamicBlockers.values()) this.blockCircle(blocker.x, blocker.z, blocker.radius);
  }

  private blockCircle(x: number, z: number, radius: number): void {
    const c = this.worldToCell(x, z);
    const r = Math.ceil(radius / this.cellSize);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = c.x + dx;
        const cy = c.y + dy;
        if (!this.inBounds(cx, cy)) continue;
        const p = this.cellCenter(cx, cy);
        if ((p.x - x) ** 2 + (p.z - z) ** 2 <= radius ** 2) this.blocked[this.index(cx, cy)] = 1;
      }
    }
  }
}

export class FlowField {
  readonly distance: Int32Array;
  readonly targetCell: Cell;

  constructor(readonly grid: NavigationGrid, targetX: number, targetZ: number) {
    const target = grid.nearestWalkableCell(targetX, targetZ);
    if (!target) throw new Error('flow field target has no walkable cell');
    this.targetCell = target;
    this.distance = new Int32Array(grid.cells * grid.cells);
    this.distance.fill(-1);
    this.build();
  }

  directionAt(x: number, z: number): { x: number; z: number; distance: number } {
    const cell = this.grid.worldToCell(x, z);
    const here = this.distance[this.grid.index(cell.x, cell.y)];
    if (here <= 0) return { x: 0, z: 0, distance: here };

    let best = here;
    let bestCell = cell;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const cx = cell.x + dx;
        const cy = cell.y + dy;
        if (!this.grid.isWalkableCell(cx, cy)) continue;
        const d = this.distance[this.grid.index(cx, cy)];
        if (d >= 0 && d < best) {
          best = d;
          bestCell = { x: cx, y: cy };
        }
      }
    }

    const from = this.grid.cellCenter(cell.x, cell.y);
    const to = this.grid.cellCenter(bestCell.x, bestCell.y);
    const vx = to.x - from.x;
    const vz = to.z - from.z;
    const len = Math.hypot(vx, vz) || 1;
    return { x: vx / len, z: vz / len, distance: here };
  }

  private build(): void {
    const qx = new Int32Array(this.grid.cells * this.grid.cells);
    const qy = new Int32Array(this.grid.cells * this.grid.cells);
    let head = 0;
    let tail = 0;
    const targetIndex = this.grid.index(this.targetCell.x, this.targetCell.y);
    this.distance[targetIndex] = 0;
    qx[tail] = this.targetCell.x;
    qy[tail++] = this.targetCell.y;

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const;

    while (head < tail) {
      const cx = qx[head];
      const cy = qy[head++];
      const base = this.distance[this.grid.index(cx, cy)];
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.grid.isWalkableCell(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!this.grid.isWalkableCell(cx + dx, cy) || !this.grid.isWalkableCell(cx, cy + dy))) {
          continue;
        }
        const ni = this.grid.index(nx, ny);
        if (this.distance[ni] !== -1) continue;
        this.distance[ni] = base + (dx === 0 || dy === 0 ? 10 : 14);
        qx[tail] = nx;
        qy[tail++] = ny;
      }
    }
  }
}
