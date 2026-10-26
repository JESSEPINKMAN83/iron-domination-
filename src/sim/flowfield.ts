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
  halfWidth?: number;
  halfDepth?: number;
}

export interface DynamicBlockerSnapshot extends BlockedFootprint {
  id: number;
  halfWidth?: number;
  halfDepth?: number;
}

export class NavigationGrid {
  readonly heightfield: Heightfield;
  readonly cells: number;
  readonly cellSize: number;
  readonly size: number;
  readonly blocked: Uint8Array;
  revision = 0;
  private flowCacheRevision = -1;
  private readonly flowCache = new Map<number, FlowField>();
  private flowQueue?: Int32Array;

  /** Builds are synchronous; all destinations reuse one bounded scratch queue. */
  flowBuildQueue(): Int32Array {
    return this.flowQueue ??= new Int32Array(this.cells*this.cells);
  }

  flowTo(x: number, z: number): FlowField {
    if(this.flowCacheRevision!==this.revision){this.flowCache.clear();this.flowCacheRevision=this.revision;}
    const cell=this.nearestWalkableCell(x,z);
    if(!cell) throw new Error('flow field target has no walkable cell');
    const key=this.index(cell.x,cell.y);
    const cached=this.flowCache.get(key);
    if(cached){this.flowCache.delete(key);this.flowCache.set(key,cached);return cached;}
    const field=new FlowField(this,x,z);
    this.flowCache.set(key,field);
    if(this.flowCache.size>6) this.flowCache.delete(this.flowCache.keys().next().value!);
    return field;
  }
  private blockerBatchDepth = 0;
  private blockerBatchDirty = false;
  private readonly baseBlocked: Uint8Array;
  private readonly dynamicBlockers = new Map<number, DynamicBlocker>();

  constructor(hf: Heightfield, footprints: BlockedFootprint[] = []) {
    this.heightfield = hf;
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

  /**
   * Guaranteed walkable cell: the radius-limited nearestWalkableCell can miss when a
   * spawn point sits in a large water/cliff region (some map seeds). This full-grid
   * scan returns the walkable cell closest to (x,z), or undefined only if the entire
   * map is unwalkable. Use for critical placement (bases) that must never fail.
   */
  nearestWalkableCellGlobal(x: number, z: number): Cell | undefined {
    const near = this.nearestWalkableCell(x, z);
    if (near) return near;
    const start = this.worldToCell(x, z);
    let best: Cell | undefined;
    let bestD2 = Infinity;
    for (let cy = 0; cy < this.cells; cy++) {
      for (let cx = 0; cx < this.cells; cx++) {
        if (this.blocked[this.index(cx, cy)] !== 0) continue;
        const d2 = (cx - start.x) ** 2 + (cy - start.y) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = { x: cx, y: cy };
        }
      }
    }
    return best;
  }

  setDynamicBlocker(id: number, x: number, z: number, radius: number): void {
    this.dynamicBlockers.set(id, { id, x, z, radius });
    this.invalidateBlockers();
  }

  setBuildingBlocker(id: number, x: number, z: number, halfWidth: number, halfDepth: number): void {
    this.dynamicBlockers.set(id, { id, x, z, radius: Math.hypot(halfWidth, halfDepth), halfWidth, halfDepth });
    this.invalidateBlockers();
  }

  batchBlockers<T>(change: () => T): T {
    this.blockerBatchDepth++;
    try { return change(); }
    finally {
      this.blockerBatchDepth--;
      if (!this.blockerBatchDepth && this.blockerBatchDirty) {
        this.blockerBatchDirty = false;
        this.rebuildBlocked();
      }
    }
  }

  private invalidateBlockers(): void {
    if (this.blockerBatchDepth) this.blockerBatchDirty = true;
    else this.rebuildBlocked();
  }

  isWalkableSegment(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toZ - fromZ) / (this.cellSize * 0.45)));
    for (let i = 1; i <= steps; i++) {
      const cell = this.worldToCell(fromX + (toX - fromX) * i / steps, fromZ + (toZ - fromZ) * i / steps);
      if (!this.isWalkableCell(cell.x, cell.y)) return false;
    }
    return true;
  }

  removeDynamicBlocker(id: number): void {
    if (!this.dynamicBlockers.delete(id)) return;
    this.invalidateBlockers();
  }

  snapshotDynamicBlockers(): DynamicBlockerSnapshot[] {
    return Array.from(this.dynamicBlockers.values()).map((blocker) => ({ ...blocker }));
  }

  restoreDynamicBlockers(blockers: DynamicBlockerSnapshot[]): void {
    this.dynamicBlockers.clear();
    for (const blocker of blockers) this.dynamicBlockers.set(blocker.id, { ...blocker });
    this.rebuildBlocked();
  }

  private rebuildBlocked(): void {
    this.blocked.set(this.baseBlocked);
    for (const blocker of this.dynamicBlockers.values()) {
      if (blocker.halfWidth !== undefined && blocker.halfDepth !== undefined) {
        const min = this.worldToCell(blocker.x - blocker.halfWidth, blocker.z - blocker.halfDepth);
        const max = this.worldToCell(blocker.x + blocker.halfWidth, blocker.z + blocker.halfDepth);
        for (let cy = min.y; cy <= max.y; cy++) for (let cx = min.x; cx <= max.x; cx++) this.blocked[this.index(cx, cy)] = 1;
      } else this.blockCircle(blocker.x, blocker.z, blocker.radius);
    }
    this.revision++;
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
  private builtRevision = -1;
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
    if (here <= 0) {
      if (this.builtRevision !== this.grid.revision && this.refreshAfterChange()) return this.directionAt(x, z);
      return { x: 0, z: 0, distance: here };
    }

    let best = here;
    let bestCell = cell;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const cx = cell.x + dx;
        const cy = cell.y + dy;
        if (!this.grid.isWalkableCell(cx, cy)) continue;
        if (dx !== 0 && dy !== 0 && (!this.grid.isWalkableCell(cell.x + dx, cell.y) || !this.grid.isWalkableCell(cell.x, cell.y + dy))) continue;
        const d = this.distance[this.grid.index(cx, cy)];
        if (d >= 0 && d < best) {
          best = d;
          bestCell = { x: cx, y: cy };
        }
      }
    }

    // Rebuild only when a changed obstacle actually blocks this route. A distant
    // construction event must not rebuild every army's flow fields at once.
    if (bestCell === cell && this.builtRevision !== this.grid.revision && this.refreshAfterChange()) return this.directionAt(x, z);

    const from = this.grid.cellCenter(cell.x, cell.y);
    const to = this.grid.cellCenter(bestCell.x, bestCell.y);
    const vx = to.x - from.x;
    const vz = to.z - from.z;
    const len = Math.hypot(vx, vz) || 1;
    return { x: vx / len, z: vz / len, distance: here };
  }

  private refreshAfterChange(): boolean {
    const position = this.grid.cellCenter(this.targetCell.x, this.targetCell.y);
    const target = this.grid.nearestWalkableCellGlobal(position.x, position.z);
    this.builtRevision = this.grid.revision;
    if (!target) return false;
    this.targetCell.x = target.x;
    this.targetCell.y = target.y;
    this.distance.fill(-1);
    this.build();
    return true;
  }

  private build(): void {
    this.builtRevision = this.grid.revision;
    const queue = this.grid.flowBuildQueue();
    let head = 0;
    let tail = 0;
    const targetIndex = this.grid.index(this.targetCell.x, this.targetCell.y);
    this.distance[targetIndex] = 0;
    queue[tail++] = targetIndex;

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
      const cell = queue[head++];
      const cx = cell % this.grid.cells;
      const cy = Math.floor(cell / this.grid.cells);
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
        queue[tail++] = ni;
      }
    }
  }
}
