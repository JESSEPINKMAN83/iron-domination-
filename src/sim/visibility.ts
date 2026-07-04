// Per-team fog-of-war grid. Deterministic: derived purely from sim state each
// tick. 0 = never seen (shroud), 1 = explored (dim), 2 = currently visible.
import type { Heightfield } from './heightfield';
import type { GameSim } from './world';

export const FOG_RES = 128;

export class VisibilityGrid {
  readonly res = FOG_RES;
  readonly cellSize: number;
  readonly state: Uint8Array;
  private readonly half: number;

  constructor(hf: Heightfield, readonly teamId: number) {
    this.cellSize = hf.size / this.res;
    this.half = hf.size / 2;
    this.state = new Uint8Array(this.res * this.res);
  }

  update(sim: GameSim): void {
    const { state } = this;
    for (let i = 0; i < state.length; i++) if (state[i] === 2) state[i] = 1;
    for (const entity of sim.world.entities) {
      if (entity.team?.id !== this.teamId || entity.destroyed) continue;
      const radius = entity.vision?.radius;
      if (!radius) continue;
      this.stampDisc(entity.transform.x, entity.transform.z, radius);
    }
  }

  isVisibleWorld(x: number, z: number): boolean {
    return this.state[this.indexWorld(x, z)] === 2;
  }

  isExploredWorld(x: number, z: number): boolean {
    return this.state[this.indexWorld(x, z)] >= 1;
  }

  private indexWorld(x: number, z: number): number {
    const cx = Math.min(this.res - 1, Math.max(0, Math.floor((x + this.half) / this.cellSize)));
    const cz = Math.min(this.res - 1, Math.max(0, Math.floor((z + this.half) / this.cellSize)));
    return cz * this.res + cx;
  }

  private stampDisc(x: number, z: number, radius: number): void {
    const minX = Math.max(0, Math.floor((x - radius + this.half) / this.cellSize));
    const maxX = Math.min(this.res - 1, Math.floor((x + radius + this.half) / this.cellSize));
    const minZ = Math.max(0, Math.floor((z - radius + this.half) / this.cellSize));
    const maxZ = Math.min(this.res - 1, Math.floor((z + radius + this.half) / this.cellSize));
    const r2 = radius * radius;
    for (let cz = minZ; cz <= maxZ; cz++) {
      const wz = (cz + 0.5) * this.cellSize - this.half;
      for (let cx = minX; cx <= maxX; cx++) {
        const wx = (cx + 0.5) * this.cellSize - this.half;
        if ((wx - x) ** 2 + (wz - z) ** 2 <= r2) this.state[cz * this.res + cx] = 2;
      }
    }
  }
}
