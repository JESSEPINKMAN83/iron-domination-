import { WALL_HEIGHT } from '../content/phase3';
import type { Entity } from './components';
import { sampleHeight } from './heightfield';
import { SpatialHash } from './spatialHash';
import type { GameSim } from './world';

interface Point3 { x: number; y: number; z: number }
const coverCache = new WeakMap<GameSim, { revision: number; walls: SpatialHash<Entity>; radius: number; count: number }>();

/** Find the first solid wall crossed by a bullet, including friendly cover. */
export function firstWallCoverHit(sim: GameSim, from: Point3, to: Point3, ignore?: Entity): { wall: Entity; x: number; y: number; z: number } | undefined {
  let cache = coverCache.get(sim);
  if (!cache || cache.revision !== sim.nav.revision) {
    const walls = [...sim.buildingsQuery].filter((entity) => entity.building.kind === 'wall' && !entity.destroyed);
    const index = new SpatialHash<Entity>(32);
    index.rebuild(walls);
    const radius = walls.reduce((max, wall) => Math.max(max, Math.hypot(wall.building!.footprint.w, wall.building!.footprint.h) * sim.nav.cellSize), 0);
    cache = { revision: sim.nav.revision, walls: index, radius, count: walls.length };
    coverCache.set(sim, cache);
  }
  if (!cache.count) return undefined;
  let nearest = 1;
  let wall: Entity | undefined;
  cache.walls.visitNearby((from.x + to.x) / 2, (from.z + to.z) / 2, Math.hypot(to.x - from.x, to.z - from.z) / 2 + cache.radius, (candidate) => {
    if (candidate === ignore || candidate.destroyed || !candidate.building) return;
    const halfW = candidate.building.footprint.w * sim.nav.cellSize;
    const halfD = candidate.building.footprint.h * sim.nav.cellSize;
    const base = candidate.transform.y ?? sampleHeight(sim.nav.heightfield, candidate.transform.x, candidate.transform.z);
    const top = base + WALL_HEIGHT * Math.max(0.08, Math.min(1, candidate.building.buildProgress));
    let enter = 0, exit = 1;
    for (const [origin, delta, min, max] of [
      [from.x, to.x - from.x, candidate.transform.x - halfW, candidate.transform.x + halfW],
      [from.y, to.y - from.y, base, top],
      [from.z, to.z - from.z, candidate.transform.z - halfD, candidate.transform.z + halfD],
    ]) {
      if (Math.abs(delta) < 1e-9) { if (origin < min || origin > max) return; }
      else {
        const a = (min - origin) / delta, b = (max - origin) / delta;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (exit < enter) return;
      }
    }
    if (exit <= 0 || enter >= nearest) return;
    nearest = enter;
    wall = candidate;
  });
  return wall ? { wall, x: from.x + (to.x - from.x) * nearest, y: from.y + (to.y - from.y) * nearest, z: from.z + (to.z - from.z) * nearest } : undefined;
}
