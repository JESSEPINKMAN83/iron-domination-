import { CanvasTexture, SRGBColorSpace } from 'three';

/** Fine architectural panelwork. Deliberately separate from vehicle hull textures. */
export function createBuildingSurface(style: 'steel' | 'concrete' | 'rust' | 'deck'): CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const palettes = { steel: ['#b9c1c2', '#8c979c'], concrete: ['#b2b6ac', '#949c96'], rust: ['#b5ada0', '#918b7b'], deck: ['#8f9d9f', '#758286'] };
  const [top, bottom] = palettes[style];
  const gradient = ctx.createLinearGradient(0, 0, 0, 512); gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 512);
  let seed = 2389;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 9500; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(10,20,24,.035)';
    ctx.fillRect(random() * 512, random() * 512, 1 + random() * 2, 1);
  }
  // A single large panel per damage cell; avoid the old dense checkerboard roof.
  ctx.strokeStyle = 'rgba(24,40,48,.32)'; ctx.lineWidth = 2; ctx.strokeRect(5, 5, 502, 502);
  ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = 1; ctx.strokeRect(8, 8, 496, 496);
  for (const x of [18, 494]) for (const y of [18, 494]) {
    ctx.fillStyle = '#62717a'; ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillStyle = '#d4d9d6'; ctx.fillRect(x - 1, y - 2, 2, 1);
  }
  // Localized runoff at joints rather than all-over heavy noise.
  for (let i = 0; i < 16; i++) {
    const x = random() * 512, length = 15 + random() * 110;
    const stain = ctx.createLinearGradient(0, 10, 0, length);
    stain.addColorStop(0, 'rgba(35,45,43,.09)'); stain.addColorStop(1, 'rgba(35,45,43,0)');
    ctx.fillStyle = stain; ctx.fillRect(x, 10, 1 + random() * 4, length);
  }
  if (style === 'deck') {
    ctx.strokeStyle = 'rgba(34,49,57,.16)'; ctx.lineWidth = 1;
    for (let y = 28; y < 500; y += 12) { ctx.beginPath(); ctx.moveTo(15, y); ctx.lineTo(497, y); ctx.stroke(); }
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
