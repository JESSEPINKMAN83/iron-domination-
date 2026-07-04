// Fog-of-war shroud: drapes the team-1 visibility grid over the terrain using
// the terrain's own chunk geometry. Unexplored → near-black, explored → dimmed,
// visible → clear. Linear filtering gives soft fog edges for free.
import { type BufferGeometry, DataTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, RGBAFormat } from 'three';
import type { VisibilityGrid } from '../sim/visibility';

const SHROUD_ALPHA = 232;
const EXPLORED_ALPHA = 118;

export class FogView {
  readonly group = new Group();
  private readonly texture: DataTexture;
  private readonly data: Uint8Array<ArrayBuffer>;

  constructor(private readonly grid: VisibilityGrid, chunkGeometries: BufferGeometry[]) {
    this.data = new Uint8Array(new ArrayBuffer(grid.res * grid.res * 4));
    this.texture = new DataTexture(this.data, grid.res, grid.res, RGBAFormat);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    for (const geometry of chunkGeometries) {
      const mesh = new Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 90;
      this.group.add(mesh);
    }
    this.refresh();
  }

  /** Re-uploads the fog texture; call after visibility updates (once per sim tick). */
  refresh(): void {
    const { state } = this.grid;
    for (let i = 0; i < state.length; i++) {
      const alpha = state[i] === 2 ? 0 : state[i] === 1 ? EXPLORED_ALPHA : SHROUD_ALPHA;
      const o = i * 4;
      this.data[o] = 4;
      this.data[o + 1] = 6;
      this.data[o + 2] = 8;
      this.data[o + 3] = alpha;
    }
    this.texture.needsUpdate = true;
  }
}
