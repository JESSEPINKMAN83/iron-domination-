// Procedural detail textures painted on canvas — placeholder art until the
// Phase 7 content pass, but seeded and consistent.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from '../sim/noise';

type Painter = (ctx: CanvasRenderingContext2D, rng: () => number, size: number) => void;

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

export function createGrassTexture(): CanvasTexture {
  return makeTexture(256, 101, (ctx, rng, s) => {
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

export function createDirtTexture(): CanvasTexture {
  return makeTexture(256, 202, (ctx, rng, s) => {
    ctx.fillStyle = '#7a6142';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, rng, s, 30, ['#8a7050', '#66513a', '#71583e'], 12, 36, 0.22);
    speckle(ctx, rng, s, 7000, ['#8a7050', '#66513a', '#93795a', '#5b4832']);
    speckle(ctx, rng, s, 260, ['#8d8d8b', '#6f6f6d'], 1, 3);
  });
}

export function createRockTexture(): CanvasTexture {
  return makeTexture(256, 303, (ctx, rng, s) => {
    ctx.fillStyle = '#77797c';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, rng, s, 24, ['#82858a', '#6a6c70', '#8e9195'], 16, 44, 0.2);
    speckle(ctx, rng, s, 6000, ['#8b8e91', '#5f6265', '#96999c', '#6d7073']);
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
