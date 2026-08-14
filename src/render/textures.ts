// Procedural detail textures painted on canvas — placeholder art until the
// Phase 7 content pass, but seeded and consistent.
import { CanvasTexture, LinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32, fbm2 } from '../sim/noise';
import { sampleHeight, type Heightfield } from '../sim/heightfield';

type Painter = (ctx: CanvasRenderingContext2D, rng: () => number, size: number) => void;
export type TerrainTextureStyle = 'temperate' | 'desert' | 'snow';

export interface MacroTintMap {
  texture: CanvasTexture;
  data: Uint8ClampedArray;
  size: number;
  worldSize: number;
}

function makeTexture(size: number, seed: number, paint: Painter): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  paint(ctx, mulberry32(seed), size);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  size: number,
  count: number,
  colors: string[],
  rMin = 0.6,
  rMax = 2.2,
): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.globalAlpha = 0.08 + rng() * 0.16;
    const r = rMin + rng() * (rMax - rMin);
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function blotches(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  size: number,
  count: number,
  colors: string[],
  rMin: number,
  rMax: number,
  alpha: number,
): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.globalAlpha = alpha * (0.5 + rng() * 0.5);
    const r = rMin + rng() * (rMax - rMin);
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, r, r * (0.5 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function createGrassTexture(style: TerrainTextureStyle = 'temperate'): CanvasTexture {
  return makeTexture(512, 101 + styleSeed(style), (ctx, rng, s) => {
    if (style === 'desert') {
      ctx.fillStyle = '#b88d52';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 28, ['#c79d60', '#a97d48', '#d2b06e'], 18, 52, 0.19);
      speckle(ctx, rng, s, 22000, ['#c49a5c', '#a77b45', '#d8b978', '#8f6c43']);
      ctx.lineWidth = 1;
      for (let i = 0; i < 170; i++) {
        ctx.strokeStyle = rng() > 0.5 ? '#d5b36f' : '#9c7240';
        ctx.globalAlpha = 0.07 + rng() * 0.09;
        const x = rng() * s;
        const y = rng() * s;
        const len = 28 + rng() * 70;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(0.35 + rng() * 0.24) * len, y + Math.sin(0.35 + rng() * 0.24) * len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (style === 'snow') {
      ctx.fillStyle = '#d9e5ea';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 28, ['#edf5f7', '#c7d6df', '#b9cbd6'], 14, 44, 0.22);
      speckle(ctx, rng, s, 19000, ['#f8fbfb', '#c1d1da', '#e6eef2', '#aebfca']);
      ctx.lineWidth = 1;
      for (let i = 0; i < 160; i++) {
        ctx.strokeStyle = rng() > 0.5 ? '#f3f8fa' : '#b8c8d2';
        ctx.globalAlpha = 0.08 + rng() * 0.11;
        const x = rng() * s;
        const y = rng() * s;
        const len = 18 + rng() * 72;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(-0.55 + rng() * 0.18) * len, y + Math.sin(-0.55 + rng() * 0.18) * len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = '#4e6b35';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, rng, s, 26, ['#5a7a3c', '#43602e', '#557239'], 14, 40, 0.2);
    speckle(ctx, rng, s, 24000, ['#5d7f40', '#43602c', '#6c8a4a', '#3a5527']);
    ctx.lineWidth = 1;
    for (let i = 0; i < 1200; i++) {
      ctx.strokeStyle = rng() > 0.5 ? '#688748' : '#3f5c2c';
      ctx.globalAlpha = 0.1 + rng() * 0.14;
      const x = rng() * s;
      const y = rng() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() * 2 - 1), y - 2 - rng() * 2.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

export function createDirtTexture(style: TerrainTextureStyle = 'temperate'): CanvasTexture {
  return makeTexture(512, 202 + styleSeed(style), (ctx, rng, s) => {
    if (style === 'desert') {
      ctx.fillStyle = '#8b6842';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 32, ['#9e7547', '#72543a', '#b0804b'], 12, 38, 0.24);
      speckle(ctx, rng, s, 21000, ['#a67c4a', '#6c5037', '#bd8d55', '#5e4531']);
      speckle(ctx, rng, s, 260, ['#4f4030', '#c2a16d'], 1, 3);
      return;
    }
    if (style === 'snow') {
      ctx.fillStyle = '#9fb1bf';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 28, ['#b7c9d5', '#7f929f', '#cbd8df'], 12, 38, 0.22);
      speckle(ctx, rng, s, 19000, ['#c7d7df', '#7b8d9a', '#e6eef2', '#6d7e8a']);
      speckle(ctx, rng, s, 220, ['#f3f8fb', '#5f6f7b'], 1, 3);
      return;
    }
    ctx.fillStyle = '#7a6142';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, rng, s, 30, ['#8a7050', '#66513a', '#71583e'], 12, 36, 0.22);
    speckle(ctx, rng, s, 21000, ['#8a7050', '#66513a', '#93795a', '#5b4832']);
    speckle(ctx, rng, s, 260, ['#8d8d8b', '#6f6f6d'], 1, 3);
  });
}

export function createRockTexture(style: TerrainTextureStyle = 'temperate'): CanvasTexture {
  return makeTexture(512, 303 + styleSeed(style), (ctx, rng, s) => {
    if (style === 'desert') {
      ctx.fillStyle = '#9a7b58';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 24, ['#aa8a62', '#806346', '#b89567'], 16, 44, 0.22);
      speckle(ctx, rng, s, 19000, ['#b18e64', '#70563f', '#c3a070', '#8b6d4c']);
    } else if (style === 'snow') {
      ctx.fillStyle = '#8a98a3';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 24, ['#9eabb4', '#697681', '#c8d3d8'], 16, 44, 0.2);
      speckle(ctx, rng, s, 19000, ['#bfcbd1', '#5f6b75', '#e1e8eb', '#7a8790']);
    } else {
      ctx.fillStyle = '#77797c';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 24, ['#82858a', '#6a6c70', '#8e9195'], 16, 44, 0.2);
      speckle(ctx, rng, s, 19000, ['#8b8e91', '#5f6265', '#96999c', '#6d7073']);
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = rng() > 0.5 ? '#5a5d60' : '#909396';
      ctx.globalAlpha = 0.05 + rng() * 0.07;
      const x = rng() * s;
      const y = rng() * s;
      const len = 20 + rng() * 60;
      const a = (rng() * 0.4 - 0.2) + Math.PI * 0.22;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

function styleSeed(style: TerrainTextureStyle): number {
  return style === 'desert' ? 1000 : style === 'snow' ? 2000 : 0;
}

/** A seeded, map-scale colour field. Neutral is encoded at 128; the shader
 * expands the narrow range into subtle multiplicative colour variation. */
export function createMacroTintMap(hf: Heightfield, seed: number): MacroTintMap {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const image = ctx.createImageData(size, size);
  const style: TerrainTextureStyle = hf.kind === 'crater-oasis' ? 'desert' : hf.kind === 'frostbite-pass' ? 'snow' : 'temperate';
  for (let py = 0; py < size; py++) {
    const v = py / (size - 1);
    const z = (v - 0.5) * hf.size;
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const x = (u - 0.5) * hf.size;
      const broad = fbm2(u * 4.2, v * 4.2, seed ^ 0x4d414352, 4);
      const variation = fbm2(u * 13.1 + 7, v * 13.1 - 5, seed ^ 0x54494e54, 3);
      const waterDistance = Math.max(0, sampleHeight(hf, x, z) - hf.waterLevel);
      const moisture = Math.max(0, Math.min(1, 1 - waterDistance / 12));
      const factors = macroTintFactors(style, broad, variation, moisture);
      const i = (py * size + px) * 4;
      image.data[i] = encodeMacroFactor(factors[0]);
      image.data[i + 1] = encodeMacroFactor(factors[1]);
      image.data[i + 2] = encodeMacroFactor(factors[2]);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return { texture, data: image.data, size, worldSize: hf.size };
}

export function macroTintFactors(
  style: TerrainTextureStyle,
  broad: number,
  variation: number,
  moisture: number,
): readonly [number, number, number] {
  const n = (broad - 0.5) * 0.44 + (variation - 0.5) * 0.13;
  if (style === 'desert') return [1 + n * 1.08, 1 + n * 0.68, 1 + n * 0.2 - moisture * 0.065];
  if (style === 'snow') return [1 + n * 0.38, 1 + n * 0.66, 1 + n * 1.02 + moisture * 0.04];
  return [1 + n * 0.46 - moisture * 0.085, 1 + n * 1.08 + moisture * 0.035, 1 + n * 0.36 - moisture * 0.06];
}

function encodeMacroFactor(factor: number): number {
  return Math.round(Math.max(0, Math.min(1, (factor - 0.68) / 0.64)) * 255);
}

/** Creates one inexpensive shared detail normal from a procedural colour map. */
export function createDetailNormalTexture(source: CanvasTexture, strength = 1.8): CanvasTexture {
  const canvas = source.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const { width, height } = canvas;
  const src = ctx.getImageData(0, 0, width, height).data;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('2d canvas context unavailable');
  const image = outCtx.createImageData(width, height);
  const luminance = (x: number, y: number): number => {
    const px = ((y + height) % height) * width + ((x + width) % width);
    const i = px * 4;
    return (src[i] * 0.2126 + src[i + 1] * 0.7152 + src[i + 2] * 0.0722) / 255;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (luminance(x + 1, y) - luminance(x - 1, y)) * strength;
      const dy = (luminance(x, y + 1) - luminance(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 4;
      image.data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }
  outCtx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(outCanvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = NoColorSpace;
  return texture;
}

export type HullPanelStyle = 'steel' | 'concrete' | 'rust' | 'deck';

const HULL_PANEL: Record<HullPanelStyle, { seed: number; fill: string; blotch: string[]; speckle: string[] }> = {
  steel: { seed: 811, fill: '#6e7678', blotch: ['#7a8284', '#636b6d', '#5c6466'], speckle: ['#8a9294', '#5a6264', '#747c7e'] },
  concrete: { seed: 823, fill: '#7a7d74', blotch: ['#8a8d82', '#6c6f66', '#5f625a'], speckle: ['#94978c', '#686b62', '#7e8178'] },
  rust: { seed: 839, fill: '#6a5a48', blotch: ['#7a6852', '#5a4b3c', '#4e4034'], speckle: ['#8a7460', '#4a3c30', '#6e5c4a'] },
  deck: { seed: 857, fill: '#4e5c60', blotch: ['#5a6a6e', '#425054', '#3a464a'], speckle: ['#6a7a7e', '#384448', '#546468'] },
};

/**
 * Riveted plates for building hulls. Painted as a 2×2 sheet so each damage-block
 * face (UV 0–1) reads as a few plates instead of a noisy grid.
 */
export function createHullPanelTexture(style: HullPanelStyle = 'steel'): CanvasTexture {
  const palette = HULL_PANEL[style];
  return makeTexture(256, palette.seed, (ctx, rng, s) => {
    ctx.fillStyle = palette.fill;
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, rng, s, 10, palette.blotch, 20, 50, 0.18);
    speckle(ctx, rng, s, 4000, palette.speckle);

    const cols = 2;
    const rows = 2;
    const pad = 10;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * (s / cols) + pad;
        const y = row * (s / rows) + pad;
        const w = s / cols - pad * 2;
        const h = s / rows - pad * 2;
        ctx.strokeStyle = 'rgba(20, 22, 23, 0.55)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(230, 236, 238, 0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
        const rivets: Array<[number, number]> = [
          [x + 8, y + 8],
          [x + w - 8, y + 8],
          [x + 8, y + h - 8],
          [x + w - 8, y + h - 8],
          [x + w / 2, y + 8],
          [x + w / 2, y + h - 8],
        ];
        for (const [rx, ry] of rivets) {
          ctx.fillStyle = 'rgba(210, 216, 218, 0.58)';
          ctx.beginPath();
          ctx.arc(rx, ry, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(30, 32, 33, 0.45)';
          ctx.beginPath();
          ctx.arc(rx + 0.6, ry + 0.6, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
        if (rng() > 0.45) {
          ctx.fillStyle = 'rgba(18, 20, 21, 0.16)';
          ctx.fillRect(x + w * 0.18, y + h * 0.42, w * 0.64, 3);
        }
      }
    }
  });
}

export function createSteelPanelTexture(): CanvasTexture {
  return createHullPanelTexture('steel');
}

export function createOreTexture(): CanvasTexture {
  return makeTexture(256, 404, (ctx, rng, s) => {
    // darker mineral bed so the amber veins read as glowing seams
    ctx.fillStyle = '#3a2f22';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, rng, s, 30, ['#4a3a28', '#5d4a33', '#2c241a'], 12, 34, 0.4);
    speckle(ctx, rng, s, 3200, ['#54432c', '#6b5638', '#3a2f22']);
    // crystalline veins
    for (let i = 0; i < 26; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const len = 22 + rng() * 60;
      const angle = rng() * Math.PI * 2;
      const grad = ctx.createLinearGradient(x, y, x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      grad.addColorStop(0, 'rgba(240, 190, 80, 0)');
      grad.addColorStop(0.5, 'rgba(242, 198, 90, 0.85)');
      grad.addColorStop(1, 'rgba(240, 190, 80, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2 + rng() * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    }
    // bright flecks
    for (let i = 0; i < 1100; i++) {
      ctx.fillStyle = rng() > 0.5 ? '#e0a83e' : '#f2c65a';
      ctx.globalAlpha = 0.3 + rng() * 0.5;
      const r = 0.4 + rng() * 1.3;
      ctx.beginPath();
      ctx.arc(rng() * s, rng() * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}
