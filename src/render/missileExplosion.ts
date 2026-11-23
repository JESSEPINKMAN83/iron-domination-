import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace, type Camera, type Scene, type WebGLRenderer } from 'three';

const FRAMES = 24;
const COLUMNS = 6;
const TILE = 128;
let sharedAtlas: CanvasTexture | undefined;

/** One shared, prepainted atlas. No canvas work or texture uploads during playback. */
export function createMissileExplosionAtlas(): CanvasTexture {
  if (sharedAtlas) return sharedAtlas;
  const canvas = document.createElement('canvas');
  canvas.width = TILE * COLUMNS;
  canvas.height = TILE * (FRAMES / COLUMNS);
  const ctx = canvas.getContext('2d')!;
  const noise = (i: number) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  for (let frame = 0; frame < FRAMES; frame++) {
    const age = frame / (FRAMES - 1);
    ctx.save();
    ctx.translate((frame % COLUMNS) * TILE, Math.floor(frame / COLUMNS) * TILE);
    // Every frame uses the same lobe seeds: smoke expands and curls instead of blinking.
    const expansion = 0.18 + (1 - Math.exp(-age * 5)) * 0.82;
    for (let i = 0; i < 36; i++) {
      const angle = noise(i + 1) * Math.PI * 2;
      const reach = Math.sqrt(noise(i + 70));
      const x = 64 + Math.cos(angle) * reach * 31 * expansion + Math.sin(age * 3 + i) * age * 4;
      const y = 98 - age * 39 + Math.sin(angle) * reach * 25 * expansion;
      const radius = (8 + noise(i + 130) * 12) * expansion;
      const alpha = Math.min(1, age * 7) * Math.pow(1 - age, 0.55) * (0.34 + noise(i + 180) * 0.24);
      const shade = Math.round(39 + noise(i + 230) * 45 + age * 22);
      const glow = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.3, 0, x, y, radius);
      glow.addColorStop(0, `rgba(${shade + 13},${shade + 8},${shade},${alpha})`);
      glow.addColorStop(0.55, `rgba(${shade},${shade - 2},${shade - 5},${alpha * 0.8})`);
      glow.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
      ctx.fillStyle = glow; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // Irregular fire lobes cool independently; the outer smoke remains visible behind them.
    for (let i = 0; i < 22; i++) {
      const cooling = Math.max(0, 1 - age / (0.36 + noise(i + 300) * 0.23));
      if (!cooling) continue;
      const angle = noise(i + 350) * Math.PI * 2;
      const reach = Math.sqrt(noise(i + 400));
      const x = 64 + Math.cos(angle) * reach * 30 * expansion;
      const y = 96 - age * 35 + Math.sin(angle) * reach * 24 * expansion;
      const radius = (8 + noise(i + 450) * 12) * expansion;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `rgba(255,${Math.round(115 + cooling * 125)},${Math.round(30 + cooling * 160)},${cooling * 0.9})`);
      glow.addColorStop(0.4, `rgba(255,${Math.round(48 + cooling * 105)},12,${cooling * 0.88})`);
      glow.addColorStop(0.78, `rgba(115,35,10,${cooling * 0.4})`);
      glow.addColorStop(1, 'rgba(65,36,21,0)');
      ctx.fillStyle = glow; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    if (age < 0.14) {
      const radius = 22 + age * 70;
      const flash = ctx.createRadialGradient(64, 97, 0, 64, 97, radius);
      flash.addColorStop(0, `rgba(255,255,229,${(1 - age / 0.14) * 0.98})`);
      flash.addColorStop(0.32, `rgba(255,209,115,${(1 - age / 0.14) * 0.8})`);
      flash.addColorStop(1, 'rgba(255,116,25,0)');
      ctx.fillStyle = flash; ctx.fillRect(64 - radius, 97 - radius, radius * 2, radius * 2);
    }
    // Ballistic sparks are baked into this same draw, not separate particle objects.
    for (let i = 0; i < 14; i++) {
      const life = Math.max(0, 1 - age * 2.1);
      const angle = Math.PI + noise(i + 600) * Math.PI;
      const speed = 28 + noise(i + 650) * 35;
      const x = 64 + Math.cos(angle) * speed * age;
      const y = 97 + Math.sin(angle) * speed * age + age * age * 35;
      ctx.fillStyle = `rgba(255,177,73,${life * 0.8})`;
      ctx.fillRect(x, y, 0.7 + life, 0.7 + life);
    }
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return sharedAtlas = texture;
}

export function createMissileExplosionSprite(atlas: CanvasTexture): Sprite {
  const frame = { value: 0 };
  const material = new SpriteMaterial({ map: atlas, transparent: true, alphaTest: 0.012, depthWrite: false, toneMapped: false });
  material.userData.explosionFrame = frame;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.explosionFrame = frame;
    shader.fragmentShader = 'uniform float explosionFrame;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec2 tileUv = mix(vec2(0.015625), vec2(0.984375), vMapUv);
      vec2 atlasUv = (tileUv + vec2(mod(explosionFrame, 6.0), 3.0 - floor(explosionFrame / 6.0))) / vec2(6.0, 4.0);
      diffuseColor *= texture2D(map, atlasUv);
    `);
  };
  material.customProgramCacheKey = () => 'missile-explosion-atlas-v1';
  const sprite = new Sprite(material);
  sprite.name = 'missile-explosion';
  sprite.center.set(0.5, 0.22);
  return sprite;
}

export function setMissileExplosionAge(material: SpriteMaterial, age: number): void {
  (material.userData.explosionFrame as { value: number }).value = Math.min(FRAMES - 1, Math.floor(Math.max(0, age) * FRAMES));
}


let warmupSprite: Sprite | undefined;
/** Upload and compile during loading; keep one material alive so Three retains
 * the program rather than compiling it again on the first visible impact. */
export async function prewarmMissileExplosion(renderer: WebGLRenderer, camera: Camera, scene: Scene): Promise<void> {
  const atlas = createMissileExplosionAtlas();
  renderer.initTexture(atlas);
  warmupSprite ??= createMissileExplosionSprite(atlas);
  await renderer.compileAsync(warmupSprite, camera, scene);
}
