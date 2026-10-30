import type { Entity } from './components';
import { effectiveSight, infantryConcealed, WOODLAND_DETECTION_SCALE } from './terrainAdvantages';
// Per-team fog-of-war grid. Deterministic: derived purely from sim state each
// tick. 0 = never seen (shroud), 1 = explored (dim), 2 = currently visible.
import type { Heightfield } from './heightfield';
import { allianceSide, type GameSim } from './world';

export const FOG_RES = 128;

export class VisibilityGrid {
  readonly res = FOG_RES;
  readonly cellSize: number;
  readonly state: Uint8Array;
  private readonly half: number;
  private readonly concealedState: Uint8Array;
  private readonly terrain: Heightfield;
  private readonly alliedTeams = new Set<number>();

  constructor(hf: Heightfield, readonly teamId: number) {
    this.terrain=hf;
    this.concealedState=new Uint8Array(this.res*this.res);
    this.cellSize = hf.size / this.res;
    this.half = hf.size / 2;
    this.state = new Uint8Array(this.res * this.res);
  }

  update(sim: GameSim): void {
    const { state } = this;
    this.concealedState.fill(0);
    for (let i = 0; i < state.length; i++) if (state[i] === 2) state[i] = 1;
    const viewerSide = allianceSide(sim, this.teamId);
    this.alliedTeams.clear();
    for(const entity of sim.world.entities) if(entity.team && allianceSide(sim,entity.team.id)===viewerSide) this.alliedTeams.add(entity.team.id);
    for (const entity of sim.world.entities) {
      if (allianceSide(sim, entity.team?.id) !== viewerSide || entity.destroyed) continue;
      const radius = effectiveSight(this.terrain,entity);
      if (!radius) continue;
      this.stampDisc(entity.transform.x, entity.transform.z, radius);
      this.stampDisc(entity.transform.x, entity.transform.z, Math.max(24,radius*WOODLAND_DETECTION_SCALE),this.concealedState);
    }
  }

  isVisibleWorld(x: number, z: number): boolean {
    return this.state[this.indexWorld(x, z)] === 2;
  }

  isEntityVisible(entity: Entity, tick: number): boolean {
    if (entity.team && (entity.team.id===this.teamId || this.alliedTeams.has(entity.team.id))) return true;
    if (!this.isVisibleWorld(entity.transform.x,entity.transform.z)) return false;
    return !infantryConcealed(this.terrain,entity,tick) || this.concealedState[this.indexWorld(entity.transform.x,entity.transform.z)]===2;
  }

  isExploredWorld(x: number, z: number): boolean {
    return this.state[this.indexWorld(x, z)] >= 1;
  }

  private indexWorld(x: number, z: number): number {
    const cx = Math.min(this.res - 1, Math.max(0, Math.floor((x + this.half) / this.cellSize)));
    const cz = Math.min(this.res - 1, Math.max(0, Math.floor((z + this.half) / this.cellSize)));
    return cz * this.res + cx;
  }

  private stampDisc(x: number, z: number, radius: number, target=this.state): void {
    const minX = Math.max(0, Math.floor((x - radius + this.half) / this.cellSize));
    const maxX = Math.min(this.res - 1, Math.floor((x + radius + this.half) / this.cellSize));
    const minZ = Math.max(0, Math.floor((z - radius + this.half) / this.cellSize));
    const maxZ = Math.min(this.res - 1, Math.floor((z + radius + this.half) / this.cellSize));
    const r2 = radius * radius;
    const inside = (cx: number, dz2: number): boolean => ((cx + 0.5) * this.cellSize - this.half - x) ** 2 + dz2 <= r2;
    // Each row of a disc is one contiguous span. Estimate its ends, then settle
    // them with the exact per-cell test so the stamped cells never change.
    const centerCell = (x + this.half) / this.cellSize - 0.5;
    for (let cz = minZ; cz <= maxZ; cz++) {
      const dz2 = ((cz + 0.5) * this.cellSize - this.half - z) ** 2;
      if (dz2 > r2) continue;
      const halfSpan = Math.sqrt(r2 - dz2) / this.cellSize;
      let lo = Math.max(minX, Math.ceil(centerCell - halfSpan));
      let hi = Math.min(maxX, Math.floor(centerCell + halfSpan));
      while (lo > minX && inside(lo - 1, dz2)) lo--;
      while (lo <= hi && !inside(lo, dz2)) lo++;
      while (hi < maxX && inside(hi + 1, dz2)) hi++;
      while (hi >= lo && !inside(hi, dz2)) hi--;
      if (lo <= hi) target.fill(2, cz * this.res + lo, cz * this.res + hi + 1);
    }
  }
}
