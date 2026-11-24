import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
let armorScar: CanvasTexture | undefined;
let masonryScar: CanvasTexture | undefined;
/** Baked radial fractures, torn rims and soot; shared by all affected targets. */
export function impactScarTexture(masonry: boolean): CanvasTexture {
  const cached = masonry ? masonryScar : armorScar;
  if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const random = (i: number) => { const n = Math.sin(i * 127.1 + 17) * 43758.5453; return n - Math.floor(n); };
  const soot = ctx.createRadialGradient(64, 64, 7, 64, 64, 60);
  soot.addColorStop(0, 'rgba(7,6,5,0.94)'); soot.addColorStop(0.35, 'rgba(22,19,15,0.83)'); soot.addColorStop(1, 'rgba(30,26,21,0)');
  ctx.fillStyle = soot; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2, r = 10 + random(i + 1) * 13;
    ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    ctx.lineTo(64 + Math.cos(a + 0.15) * (r + 5), 64 + Math.sin(a + 0.15) * (r + 5));
    ctx.strokeStyle = masonry ? 'rgba(185,170,142,0.8)' : 'rgba(164,162,151,0.8)'; ctx.lineWidth = 2.5; ctx.stroke();
  }
  for (let i = 0; i < 15; i++) {
    const angle = random(i + 40) * Math.PI * 2, length = 22 + random(i + 60) * 35;
    ctx.beginPath(); ctx.moveTo(64 + Math.cos(angle) * 12, 64 + Math.sin(angle) * 12);
    for (let step = 1; step <= 4; step++) {
      const r = 12 + length * step / 4, jitter = (random(i * 10 + step + 100) - 0.5) * 7;
      ctx.lineTo(64 + Math.cos(angle) * r + Math.sin(angle) * jitter, 64 + Math.sin(angle) * r - Math.cos(angle) * jitter);
    }
    ctx.strokeStyle = 'rgba(9,9,8,0.9)'; ctx.lineWidth = masonry ? 1.8 : 1; ctx.stroke();
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false;
  if (masonry) masonryScar = texture; else armorScar = texture;
  return texture;
}

let flame: CanvasTexture | undefined;
let smoke: CanvasTexture | undefined;
export function targetFireTexture(): CanvasTexture {
  if (flame) return flame;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 14; i++) {
    const x = 64 + Math.sin(i * 2.4) * (22 - i), y = 105 - i * 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 22 - i * 0.6);
    g.addColorStop(0, `rgba(255,${220 - i * 6},${100 - i * 5},0.8)`);
    g.addColorStop(0.4, 'rgba(255,102,16,0.6)'); g.addColorStop(1, 'rgba(130,30,5,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  flame = new CanvasTexture(canvas); flame.colorSpace = SRGBColorSpace; flame.generateMipmaps = false; flame.minFilter = LinearFilter;
  return flame;
}
export function targetSmokeTexture(): CanvasTexture {
  if (smoke) return smoke;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 10; i++) {
    const x = 64 + Math.sin(i * 2.4) * 26, y = 64 + Math.cos(i * 1.7) * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(0.5, 'rgba(230,230,230,0.15)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  smoke = new CanvasTexture(canvas); smoke.colorSpace = SRGBColorSpace; smoke.generateMipmaps = false; smoke.minFilter = LinearFilter;
  return smoke;
}
