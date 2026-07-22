import {
  DEFAULT_ORE_AMOUNT,
  MAP_PRESETS,
  MAP_SIZE_PRESETS,
  mapConfig,
  type MapId,
  type MapSize,
} from '../content/maps';
import { startPosition } from '../content/startPositions';
import { generateHeightfield, type OreField } from '../sim/heightfield';

export type TacticalMapDeployment = {
  army: number;
  side: number;
  color: string;
  label: string;
  detail?: string;
  isLocal?: boolean;
  isOpen?: boolean;
};

export type TacticalMapOptions = {
  mapId: MapId;
  mapSize: MapSize;
  seed: number;
  oreAmount?: number;
  deployments?: TacticalMapDeployment[];
};

export type TacticalMapRaster = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  worldSize: number;
  waterCoverage: number;
  maxHeight: number;
  waterLevel: number;
  oreFields: OreField[];
};

type Rgb = readonly [number, number, number];

const RASTER_SIZE = 384;
const MAX_CACHE_ENTRIES = 10;
const rasterCache = new Map<string, TacticalMapRaster>();

const PALETTES: Record<MapId, { base: Rgb; loose: Rgb; rock: Rgb; ore: Rgb; waterDeep: Rgb; waterShallow: Rgb }> = {
  highlands: {
    base: [63, 104, 58],
    loose: [126, 111, 72],
    rock: [104, 111, 105],
    ore: [184, 141, 48],
    waterDeep: [9, 39, 52],
    waterShallow: [35, 105, 105],
  },
  'crater-oasis': {
    base: [153, 106, 65],
    loose: [190, 142, 82],
    rock: [112, 82, 61],
    ore: [194, 146, 53],
    waterDeep: [5, 51, 62],
    waterShallow: [28, 148, 151],
  },
  'frostbite-pass': {
    base: [198, 214, 217],
    loose: [143, 166, 171],
    rock: [91, 108, 121],
    ore: [199, 155, 64],
    waterDeep: [32, 55, 78],
    waterShallow: [117, 186, 201],
  },
};

export function renderTacticalMap(root: HTMLDivElement, options: TacticalMapOptions): void {
  const preset = MAP_PRESETS[options.mapId];
  const sizePreset = MAP_SIZE_PRESETS[options.mapSize];
  const raster = cachedRaster(options.mapId, options.mapSize, options.seed, options.oreAmount ?? DEFAULT_ORE_AMOUNT);

  root.replaceChildren();
  root.classList.add('tactical-map');
  root.dataset.biome = preset.biome;
  root.setAttribute(
    'aria-label',
    `${preset.label} tactical map. ${raster.worldSize} metres square, ${raster.oreFields.length} oil fields, ${Math.round(raster.waterCoverage * 100)} percent water.`,
  );

  const canvas = document.createElement('canvas');
  canvas.className = 'tactical-map__canvas';
  canvas.width = raster.width;
  canvas.height = raster.height;
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(raster.width, raster.height);
    image.data.set(raster.pixels);
    context.putImageData(image, 0, 0);
    drawOreFields(context, raster);
  }

  const grid = document.createElement('div');
  grid.className = 'tactical-map__grid';
  grid.setAttribute('aria-hidden', 'true');

  const heading = document.createElement('div');
  heading.className = 'tactical-map__heading';
  heading.innerHTML = `<span>TACTICAL SURVEY</span><strong>${preset.shortLabel}</strong>`;

  const telemetry = document.createElement('div');
  telemetry.className = 'tactical-map__telemetry';
  telemetry.innerHTML =
    `<span>${sizePreset.label} · ${raster.worldSize} × ${raster.worldSize}M</span>` +
    `<span>PEAK ${Math.round(raster.maxHeight)}M · WATER ${Math.round(raster.waterCoverage * 100)}%</span>`;

  const north = document.createElement('div');
  north.className = 'tactical-map__north';
  north.innerHTML = '<i></i><span>N</span>';
  north.setAttribute('aria-hidden', 'true');

  const scale = document.createElement('div');
  scale.className = 'tactical-map__scale';
  const scaleMetres = scaleLength(raster.worldSize);
  scale.style.setProperty('--scale-width', `${(scaleMetres / raster.worldSize) * 100}%`);
  scale.innerHTML = `<i></i><span>${scaleMetres}M</span>`;

  const legend = document.createElement('div');
  legend.className = 'tactical-map__legend';
  legend.innerHTML = '<span><i data-kind="water"></i>WATER</span><span><i data-kind="ridge"></i>RIDGE</span><span><i data-kind="ore"></i>OIL</span>';

  const markers = document.createElement('div');
  markers.className = 'tactical-map__deployments';
  for (const deployment of options.deployments ?? []) {
    const position = startPosition(raster.worldSize, deployment.army);
    const point = worldToMapPercent(raster.worldSize, position.x, position.z);
    const marker = document.createElement('div');
    marker.className = `tactical-map__deployment tactical-map__deployment--${deployment.army}`;
    marker.classList.toggle('is-local', Boolean(deployment.isLocal));
    marker.classList.toggle('is-open', Boolean(deployment.isOpen));
    marker.style.left = `${point.x}%`;
    marker.style.top = `${point.y}%`;
    marker.style.setProperty('--deployment-color', deployment.color);
    marker.innerHTML =
      `<i>${deployment.army}</i>` +
      `<span><strong>${escapeMapText(deployment.label)}</strong>` +
      `<small>SIDE ${deployment.side}${deployment.detail ? ` · ${escapeMapText(deployment.detail)}` : ''}</small></span>`;
    markers.appendChild(marker);
  }

  root.append(canvas, grid, heading, telemetry, north, markers, scale, legend);
}

export function createTacticalMapRaster(
  mapId: MapId,
  mapSize: MapSize,
  seed: number,
  resolution = RASTER_SIZE,
  oreAmount = DEFAULT_ORE_AMOUNT,
): TacticalMapRaster {
  const config = { ...mapConfig(mapId, mapSize, oreAmount), seed: Math.max(1, Math.floor(seed) || 1) };
  const hf = generateHeightfield(config);
  const width = Math.max(32, Math.floor(resolution));
  const pixels = new Uint8ClampedArray(width * width * 4);
  const palette = PALETTES[mapId];
  let waterPixels = 0;

  for (let py = 0; py < width; py++) {
    const gy = Math.min(hf.samples - 1, Math.round((py / (width - 1)) * (hf.samples - 1)));
    for (let px = 0; px < width; px++) {
      const gx = Math.min(hf.samples - 1, Math.round((px / (width - 1)) * (hf.samples - 1)));
      const sampleIndex = gy * hf.samples + gx;
      const pixelIndex = (py * width + px) * 4;
      const height = hf.heights[sampleIndex];
      const left = hf.heights[gy * hf.samples + Math.max(0, gx - 1)];
      const right = hf.heights[gy * hf.samples + Math.min(hf.samples - 1, gx + 1)];
      const down = hf.heights[Math.max(0, gy - 1) * hf.samples + gx];
      const up = hf.heights[Math.min(hf.samples - 1, gy + 1) * hf.samples + gx];
      let color: Rgb;

      if (height <= hf.waterLevel) {
        waterPixels++;
        const depth = clamp01((hf.waterLevel - height) / 11);
        color = mixRgb(palette.waterShallow, palette.waterDeep, depth);
      } else {
        const splatIndex = sampleIndex * 4;
        const weights = [
          hf.splat[splatIndex] / 255,
          hf.splat[splatIndex + 1] / 255,
          hf.splat[splatIndex + 2] / 255,
          hf.splat[splatIndex + 3] / 255,
        ] as const;
        color = weightedRgb([palette.base, palette.loose, palette.rock, palette.ore], weights);
      }

      const slopeX = right - left;
      const slopeZ = up - down;
      const hillshade = clamp(0.82 + (slopeX - slopeZ) * 0.045, 0.54, 1.16);
      const contour = height > hf.waterLevel && crossesContour(height, left, right, down, up, contourStep(mapId)) ? 0.76 : 1;
      const shoreline = height <= hf.waterLevel && (left > hf.waterLevel || right > hf.waterLevel || down > hf.waterLevel || up > hf.waterLevel);
      const finalShade = hillshade * contour * (shoreline ? 1.22 : 1);
      pixels[pixelIndex] = clampByte(color[0] * finalShade);
      pixels[pixelIndex + 1] = clampByte(color[1] * finalShade);
      pixels[pixelIndex + 2] = clampByte(color[2] * finalShade);
      pixels[pixelIndex + 3] = 255;
    }
  }

  return {
    width,
    height: width,
    pixels,
    worldSize: hf.size,
    waterCoverage: waterPixels / (width * width),
    maxHeight: hf.maxHeight,
    waterLevel: hf.waterLevel,
    oreFields: hf.oreFields.map((field) => ({ ...field })),
  };
}

export function worldToMapPercent(worldSize: number, x: number, z: number): { x: number; y: number } {
  const half = Math.max(1, worldSize) / 2;
  return {
    x: clamp(((x + half) / (half * 2)) * 100, 0, 100),
    y: clamp(((z + half) / (half * 2)) * 100, 0, 100),
  };
}

function cachedRaster(mapId: MapId, mapSize: MapSize, seed: number, oreAmount: number): TacticalMapRaster {
  const safeSeed = Math.max(1, Math.floor(seed) || 1);
  const key = `${mapId}:${mapSize}:${safeSeed}:${oreAmount}`;
  const cached = rasterCache.get(key);
  if (cached) return cached;
  const raster = createTacticalMapRaster(mapId, mapSize, safeSeed, RASTER_SIZE, oreAmount);
  rasterCache.set(key, raster);
  if (rasterCache.size > MAX_CACHE_ENTRIES) {
    const oldest = rasterCache.keys().next().value;
    if (oldest) rasterCache.delete(oldest);
  }
  return raster;
}

function drawOreFields(context: CanvasRenderingContext2D, raster: TacticalMapRaster): void {
  const scale = raster.width / raster.worldSize;
  for (const field of raster.oreFields) {
    const point = worldToMapPercent(raster.worldSize, field.x, field.z);
    const x = (point.x / 100) * raster.width;
    const y = (point.y / 100) * raster.height;
    const radius = Math.max(5, field.radius * scale);
    const glow = context.createRadialGradient(x, y, 1, x, y, radius * 1.25);
    glow.addColorStop(0, 'rgba(255,224,111,.86)');
    glow.addColorStop(0.28, 'rgba(230,178,57,.58)');
    glow.addColorStop(1, 'rgba(230,178,57,0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, radius * 1.25, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(255,220,101,.78)';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(x, y, Math.max(3, radius * 0.42), 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#ffe28a';
    context.beginPath();
    context.arc(x, y, 1.5, 0, Math.PI * 2);
    context.fill();
  }
}

function scaleLength(worldSize: number): number {
  if (worldSize >= 1200) return 300;
  if (worldSize >= 900) return 200;
  return 150;
}

function contourStep(mapId: MapId): number {
  if (mapId === 'frostbite-pass') return 8;
  if (mapId === 'crater-oasis') return 7;
  return 6;
}

function crossesContour(center: number, left: number, right: number, down: number, up: number, step: number): boolean {
  const band = Math.floor(center / step);
  return Math.floor(left / step) !== band || Math.floor(right / step) !== band || Math.floor(down / step) !== band || Math.floor(up / step) !== band;
}

function weightedRgb(colors: readonly Rgb[], weights: readonly number[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let index = 0; index < colors.length; index++) {
    const weight = weights[index] ?? 0;
    r += colors[index][0] * weight;
    g += colors[index][1] * weight;
    b += colors[index][2] * weight;
    total += weight;
  }
  const safeTotal = Math.max(0.001, total);
  return [r / safeTotal, g / safeTotal, b / safeTotal];
}

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp01(amount);
  return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t];
}

function escapeMapText(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clampByte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
