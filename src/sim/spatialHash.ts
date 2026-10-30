export interface SpatialPoint {
  transform: { x: number; z: number };
}

/**
 * Small deterministic broad-phase grid used by the simulation. Rebuilding it is
 * linear in entity count and turns the hot "check every entity" loops into local
 * neighbourhood queries. Bucket insertion and traversal order are stable, which
 * keeps lockstep simulations deterministic.
 *
 * Cells live in a dense array covering the occupied area: target scans of long
 * range units touch hundreds of cells per query, and hashed lookups dominated.
 */
export class SpatialHash<T extends SpatialPoint> {
  private buckets: (T[] | undefined)[] = [];
  /** Per-cell OR of `maskOf(item)` from the last rebuild, when one was given. */
  private masks = new Int32Array(0);
  private masked = false;
  private originX = 0;
  private originZ = 0;
  private width = 0;
  private height = 0;

  constructor(private readonly cellSize: number) {}

  rebuild(items: Iterable<T>, maskOf?: (item: T) => number): void {
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const item of items) {
      const cx = this.cell(item.transform.x);
      const cz = this.cell(item.transform.z);
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cz < minZ) minZ = cz;
      if (cz > maxZ) maxZ = cz;
    }
    this.masked = maskOf !== undefined;
    if (minX > maxX) {
      this.width = 0;
      this.height = 0;
      this.buckets = [];
      return;
    }
    this.originX = minX;
    this.originZ = minZ;
    this.width = maxX - minX + 1;
    this.height = maxZ - minZ + 1;
    const cells = this.width * this.height;
    this.buckets = new Array<T[] | undefined>(cells);
    if (maskOf) {
      if (this.masks.length < cells) this.masks = new Int32Array(cells);
      else this.masks.fill(0, 0, cells);
    }
    for (const item of items) {
      const index = (this.cell(item.transform.z) - minZ) * this.width + this.cell(item.transform.x) - minX;
      const bucket = this.buckets[index];
      if (bucket) bucket.push(item);
      else this.buckets[index] = [item];
      if (maskOf) this.masks[index] |= maskOf(item);
    }
  }

  /**
   * Nearest cells first: rings of cells around the query cell, skipping cells
   * whose mask has nothing in `wanted` (when the last rebuild had masks) and
   * cells wholly outside `radius`, and stopping once every point in the next
   * ring is farther than `limit()`. Every wanted item within `radius` and
   * `limit()` is still visited, so a nearest-wins search returns the same
   * answer with far fewer visits.
   */
  visitNearestMasked(x: number, z: number, radius: number, wanted: number, visit: (item: T) => void, limit: () => number): void {
    if (this.width === 0) return;
    const minX = this.cell(x - radius);
    const maxX = this.cell(x + radius);
    const minZ = this.cell(z - radius);
    const maxZ = this.cell(z + radius);
    const cx = this.cell(x);
    const cz = this.cell(z);
    const rings = Math.max(cx - minX, maxX - cx, cz - minZ, maxZ - cz);
    const loX = Math.max(minX, this.originX);
    const hiX = Math.min(maxX, this.originX + this.width - 1);
    const loZ = Math.max(minZ, this.originZ);
    const hiZ = Math.min(maxZ, this.originZ + this.height - 1);
    // Corner cells of the bounding square can lie wholly outside the circle.
    const reachSq = radius * radius * 1.0001 + 1e-6;
    const visitCell = (gx: number, gz: number): void => {
      if (gx < loX || gx > hiX || gz < loZ || gz > hiZ) return;
      const index = (gz - this.originZ) * this.width + gx - this.originX;
      const bucket = this.buckets[index];
      if (!bucket || (this.masked && (this.masks[index] & wanted) === 0)) return;
      const nearX = Math.max(gx * this.cellSize, Math.min(x, (gx + 1) * this.cellSize)) - x;
      const nearZ = Math.max(gz * this.cellSize, Math.min(z, (gz + 1) * this.cellSize)) - z;
      if (nearX * nearX + nearZ * nearZ > reachSq) return;
      for (const item of bucket) visit(item);
    };
    for (let ring = 0; ring <= rings; ring++) {
      // The query point lies inside the centre cell, so ring k is at least
      // (k - 1) cells away along one axis.
      if (ring > 1 && (ring - 1) * this.cellSize > limit()) return;
      if (ring === 0) {
        visitCell(cx, cz);
        continue;
      }
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        visitCell(gx, cz - ring);
        visitCell(gx, cz + ring);
      }
      for (let gz = cz - ring + 1; gz <= cz + ring - 1; gz++) {
        visitCell(cx - ring, gz);
        visitCell(cx + ring, gz);
      }
    }
  }

  visitNearby(x: number, z: number, radius: number, visit: (item: T) => void): void {
    if (this.width === 0) return;
    const minX = Math.max(this.cell(x - radius), this.originX);
    const maxX = Math.min(this.cell(x + radius), this.originX + this.width - 1);
    const minZ = Math.max(this.cell(z - radius), this.originZ);
    const maxZ = Math.min(this.cell(z + radius), this.originZ + this.height - 1);
    for (let cz = minZ; cz <= maxZ; cz++) {
      const row = (cz - this.originZ) * this.width - this.originX;
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.buckets[row + cx];
        if (!bucket) continue;
        for (const item of bucket) visit(item);
      }
    }
  }

  private cell(value: number): number {
    // `| 0` keeps a non-finite coordinate in cell 0, as the old packed keys did.
    return Math.floor(value / this.cellSize) | 0;
  }
}
