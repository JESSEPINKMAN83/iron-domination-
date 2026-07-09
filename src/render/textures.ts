// Procedural detail textures painted on canvas — placeholder art until the
// Phase 7 content pass, but seeded and consistent.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from '../sim/noise';

type Painter = (ctx: CanvasRenderingContext2D, rng: () => number, size: number) => void;
export type TerrainTextureStyle = 'temperate' | 'desert' | 'snow';

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
  return makeTexture(256, 101 + styleSeed(style), (ctx, rng, s) => {
    if (style === 'desert') {
      ctx.fillStyle = '#b88d52';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 28, ['#c79d60', '#a97d48', '#d2b06e'], 18, 52, 0.19);
      speckle(ctx, rng, s, 8200, ['#c49a5c', '#a77b45', '#d8b978', '#8f6c43']);
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
      speckle(ctx, rng, s, 7200, ['#f8fbfb', '#c1d1da', '#e6eef2', '#aebfca']);
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
    speckle(ctx, rng, s, 9000, ['#5d7f40', '#43602c', '#6c8a4a', '#3a5527']);
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
  return makeTexture(256, 202 + styleSeed(style), (ctx, rng, s) => {
    if (style === 'desert') {
      ctx.fillStyle = '#8b6842';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 32, ['#9e7547', '#72543a', '#b0804b'], 12, 38, 0.24);
      speckle(ctx, rng, s, 7300, ['#a67c4a', '#6c5037', '#bd8d55', '#5e4531']);
      speckle(ctx, rng, s, 260, ['#4f4030', '#c2a16d'], 1, 3);
      return;
    }
    if (style === 'snow') {
      ctx.fillStyle = '#9fb1bf';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 28, ['#b7c9d5', '#7f929f', '#cbd8df'], 12, 38, 0.22);
      speckle(ctx, rng, s, 6500, ['#c7d7df', '#7b8d9a', '#e6eef2', '#6d7e8a']);
      speckle(ctx, rng, s, 220, ['#f3f8fb', '#5f6f7b'], 1, 3);
      return;
    }
    ctx.fillStyle = '#7a6142';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, rng, s, 30, ['#8a7050', '#66513a', '#71583e'], 12, 36, 0.22);
    speckle(ctx, rng, s, 7000, ['#8a7050', '#66513a', '#93795a', '#5b4832']);
    speckle(ctx, rng, s, 260, ['#8d8d8b', '#6f6f6d'], 1, 3);
  });
}

export function createRockTexture(style: TerrainTextureStyle = 'temperate'): CanvasTexture {
  return makeTexture(256, 303 + styleSeed(style), (ctx, rng, s) => {
    if (style === 'desert') {
      ctx.fillStyle = '#9a7b58';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 24, ['#aa8a62', '#806346', '#b89567'], 16, 44, 0.22);
      speckle(ctx, rng, s, 6000, ['#b18e64', '#70563f', '#c3a070', '#8b6d4c']);
    } else if (style === 'snow') {
      ctx.fillStyle = '#8a98a3';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 24, ['#9eabb4', '#697681', '#c8d3d8'], 16, 44, 0.2);
      speckle(ctx, rng, s, 6000, ['#bfcbd1', '#5f6b75', '#e1e8eb', '#7a8790']);
    } else {
      ctx.fillStyle = '#77797c';
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, rng, s, 24, ['#82858a', '#6a6c70', '#8e9195'], 16, 44, 0.2);
      speckle(ctx, rng, s, 6000, ['#8b8e91', '#5f6265', '#96999c', '#6d7073']);
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

export function createOreTexture(): CanvasTexture {
  return makeTexture(256, 404, (ctx, rng, s) => {
    ctx.fillStyle = '#5d4a33';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, rng, s, 34, ['#a2762c', '#8a6526', '#6e5320'], 10, 30, 0.3);
    speckle(ctx, rng, s, 4000, ['#6b5638', '#54432c', '#7d6440']);
    // bright crystalline flecks — catch a little bloom
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rng() > 0.5 ? '#e0a83e' : '#f2c65a';
      ctx.globalAlpha = 0.35 + rng() * 0.4;
      const r = 0.5 + rng() * 1.4;
      ctx.beginPath();
      ctx.arc(rng() * s, rng() * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}
