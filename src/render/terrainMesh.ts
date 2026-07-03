// Builds the chunked terrain mesh with a splat-mapped standard material
// (CSM-shadow compatible) plus a walkability debug overlay (F3).
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
} from 'three';
import type { CSM } from 'three/addons/csm/CSM.js';
import type { Heightfield } from '../sim/heightfield';
import { createDirtTexture, createGrassTexture, createOreTexture, createRockTexture } from './textures';

const CHUNKS = 4;

function buildChunkGeometry(hf: Heightfield, startX: number, startY: number, chunkCells: number): BufferGeometry {
  const { heights, samples, cells, cellSize } = hf;
  const half = hf.size / 2;
  const w = chunkCells + 1;
  const positions = new Float32Array(w * w * 3);
  const normals = new Float32Array(w * w * 3);
  const uvs = new Float32Array(w * w * 2);

  for (let vy = 0; vy < w; vy++) {
    const gy = startY + vy;
    for (let vx = 0; vx < w; vx++) {
      const gx = startX + vx;
      const i = vy * w + vx;
      const h = heights[gy * samples + gx];
      positions[i * 3] = gx * cellSize - half;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = gy * cellSize - half;

      // analytic normal from the shared heightfield → seamless across chunks
      const hL = heights[gy * samples + Math.max(gx - 1, 0)];
      const hR = heights[gy * samples + Math.min(gx + 1, samples - 1)];
      const hD = heights[Math.max(gy - 1, 0) * samples + gx];
      const hU = heights[Math.min(gy + 1, samples - 1) * samples + gx];
      const nx = hL - hR;
      const ny = 2 * cellSize;
      const nz = hD - hU;
      const inv = 1 / Math.hypot(nx, ny, nz);
      normals[i * 3] = nx * inv;
      normals[i * 3 + 1] = ny * inv;
      normals[i * 3 + 2] = nz * inv;

      uvs[i * 2] = gx / cells;
      uvs[i * 2 + 1] = gy / cells;
    }
  }

  const indices = new Uint32Array(chunkCells * chunkCells * 6);
  let o = 0;
  for (let vy = 0; vy < chunkCells; vy++) {
    for (let vx = 0; vx < chunkCells; vx++) {
      const a = vy * w + vx;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('normal', new BufferAttribute(normals, 3));
  geom.setAttribute('uv', new BufferAttribute(uvs, 2));
  geom.setIndex(new BufferAttribute(indices, 1));
  return geom;
}

export class TerrainView {
  readonly group = new Group();
  private readonly overlayGroup = new Group();

  constructor(hf: Heightfield, csm: CSM, maxAnisotropy: number) {
    const material = createSplatMaterial(hf, csm, maxAnisotropy);
    const overlayMaterial = createWalkOverlayMaterial(hf);

    const chunkCells = hf.cells / CHUNKS;
    for (let cy = 0; cy < CHUNKS; cy++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const geom = buildChunkGeometry(hf, cx * chunkCells, cy * chunkCells, chunkCells);
        const mesh = new Mesh(geom, material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);

        const overlay = new Mesh(geom, overlayMaterial);
        overlay.matrixAutoUpdate = false;
        overlay.renderOrder = 100;
        this.overlayGroup.add(overlay);
      }
    }
    this.overlayGroup.visible = false;
    this.overlayGroup.renderOrder = 100;
    this.group.add(this.overlayGroup);
  }

  toggleWalkOverlay(): boolean {
    this.overlayGroup.visible = !this.overlayGroup.visible;
    return this.overlayGroup.visible;
  }
}

function createSplatMaterial(hf: Heightfield, csm: CSM, maxAnisotropy: number): MeshStandardMaterial {
  const grass = createGrassTexture();
  const dirt = createDirtTexture();
  const rock = createRockTexture();
  const ore = createOreTexture();
  const aniso = Math.min(8, maxAnisotropy);
  for (const t of [grass, dirt, rock, ore]) t.anisotropy = aniso;

  const splatTex = new DataTexture(new Uint8Array(hf.splat), hf.samples, hf.samples, RGBAFormat);
  splatTex.minFilter = LinearFilter;
  splatTex.magFilter = LinearFilter;
  splatTex.needsUpdate = true;

  const material = new MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
  material.defines = { USE_UV: '' };

  // CSM patches shadows via onBeforeCompile; wrap it so our splat patch composes.
  csm.setupMaterial(material);
  const csmCompile = material.onBeforeCompile;
  const tiling = hf.size / 9; // one detail tile every 9 m

  material.onBeforeCompile = (shader, renderer) => {
    csmCompile?.call(material, shader, renderer);
    shader.uniforms.uSplat = { value: splatTex };
    shader.uniforms.uGrass = { value: grass };
    shader.uniforms.uDirt = { value: dirt };
    shader.uniforms.uRock = { value: rock };
    shader.uniforms.uOre = { value: ore };
    shader.uniforms.uTiling = { value: tiling };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>
        uniform sampler2D uSplat;
        uniform sampler2D uGrass;
        uniform sampler2D uDirt;
        uniform sampler2D uRock;
        uniform sampler2D uOre;
        uniform float uTiling;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec4 splatW = texture2D(uSplat, vUv);
          splatW /= max(splatW.r + splatW.g + splatW.b + splatW.a, 1e-4);
          vec2 tUv = vUv * uTiling;
          vec3 splatCol =
            splatW.r * texture2D(uGrass, tUv).rgb +
            splatW.g * texture2D(uDirt, tUv).rgb +
            splatW.b * texture2D(uRock, tUv).rgb +
            splatW.a * texture2D(uOre, tUv).rgb;
          diffuseColor.rgb *= splatCol;
        }`,
      );
  };
  return material;
}

function createWalkOverlayMaterial(hf: Heightfield): MeshBasicMaterial {
  const { cells, walkable } = hf;
  const data = new Uint8Array(cells * cells * 4);
  for (let i = 0; i < walkable.length; i++) {
    if (walkable[i]) {
      data[i * 4] = 60;
      data[i * 4 + 1] = 220;
      data[i * 4 + 2] = 120;
      data[i * 4 + 3] = 26;
    } else {
      data[i * 4] = 255;
      data[i * 4 + 1] = 45;
      data[i * 4 + 2] = 45;
      data[i * 4 + 3] = 210;
    }
  }
  const tex = new DataTexture(data, cells, cells, RGBAFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    toneMapped: false,
  });
}
