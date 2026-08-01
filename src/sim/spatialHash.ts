export interface SpatialPoint {
  transform: { x: number; z: number };
}

/**
 * Small deterministic broad-phase grid used by the simulation. Rebuilding it is
 * linear in entity count and turns the hot "check every entity" loops into local
 * neighbourhood queries. Bucket insertion and traversal order are stable, which
 * keeps lockstep simulations deterministic.
 */
export class SpatialHash<T extends SpatialPoint> {
  private readonly buckets = new Map<number, T[]>();

  constructor(private readonly cellSize: number) {}

  rebuild(items: Iterable<T>): void {
    this.buckets.clear();
    for (const item of items) {
      const key = this.keyFor(item.transform.x, item.transform.z);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(item);
      else this.buckets.set(key, [item]);
    }
  }

  visitNearby(x: number, z: number, radius: number, visit: (item: T) => void): void {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.buckets.get(this.key(cx, cz));
        if (!bucket) continue;
        for (const item of bucket) visit(item);
      }
    }
  }

  private keyFor(x: number, z: number): number {
    return this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
  }

  private key(x: number, z: number): number {
    // Map dimensions are far below 65k cells; packing avoids per-query strings.
    return ((x & 0xffff) << 16) | (z & 0xffff);
  }
}
