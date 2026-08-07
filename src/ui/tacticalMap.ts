import {
  DEFAULT_ORE_AMOUNT,
  MAP_PRESETS,
  MAP_SIZE_PRESETS,
  mapConfig,
  type MapId,
  type MapSize,
} from '../content/maps';
import {
  SPAWN_EDGE_LIMIT,
  SPAWN_GRID,
  snapSpawnPoint,
  spawnPointsTooClose,
  startPosition,
  type SpawnPoint,
} from '../content/startPositions';
import { generateHeightfield, type OreField } from '../sim/heightfield';

export type TacticalMapDeployment = {
  army: number;
  side: number;
  color: string;
  label: string;
  detail?: string;
  isLocal?: boolean;
  isOpen?: boolean;
  /** Normalised offset from map centre. Defaults to the army's corner slot. */
  point?: SpawnPoint;
};

export type TacticalMapOptions = {
  mapId: MapId;
  mapSize: MapSize;
  seed: number;
  oreAmount?: number;
  terrainRelief?: number;
  deployments?: TacticalMapDeployment[];
  /** Enables dragging deployment markers to reposition starting bases. */
  onDeploymentMove?: (army: number, point: SpawnPoint) => void;
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
  /**
   * Coarse grid marking where a base can be founded: 1 = dry, buildable ground.
   * Kept small on purpose, since a full-resolution copy of the heightfield would
   * dwarf the rest of the cached raster.
   */
  placement: Uint8Array;
  placementSize: number;
};

/** Grid resolution of {@link TacticalMapRaster.placement}. */
const PLACEMENT_SIZE = 96;

type Rgb = readonly [number, number, number];

const RASTER_SIZE = 1024;
const MAX_CACHE_ENTRIES = 10;
const rasterCache = new Map<string, TacticalMapRaster>();

/** Sun sits north-west and 40 degrees up, the convention cartographic relief maps use. */
const LIGHT: Rgb = normalize([-0.62, 0.64, -0.45]);
/**
 * Target root-mean-square surface slope after exaggeration. Relief is tiny next
 * to map width (tens of metres across a kilometre), so shading is normalised to
 * this instead of using a fixed multiplier — gentle and extreme maps both read.
 * Kept low, and capped, so slopes shade rather than saturate to black/white.
 */
const TARGET_RMS_SLOPE = 0.2;
const MAX_EXAGGERATION = 18;

type Palette = {
  base: Rgb;
  loose: Rgb;
  rock: Rgb;
  ore: Rgb;
  /** Tint blended into the highest ground (snow caps, bleached sand, bare stone). */
  peak: Rgb;
  /** Tint blended into the lowest dry ground, just above the shoreline. */
  basin: Rgb;
  waterDeep: Rgb;
  waterShallow: Rgb;
  /** Surf band drawn where land meets water. */
  surf: Rgb;
};

const PALETTES: Record<MapId, Palette> = {
  highlands: {
    base: [74, 112, 62],
    loose: [138, 122, 78],
    rock: [116, 120, 112],
    ore: [184, 141, 48],
    peak: [176, 178, 166],
    basin: [52, 84, 55],
    waterDeep: [8, 34, 51],
    waterShallow: [46, 122, 126],
    surf: [156, 208, 202],
  },
  'crater-oasis': {
    base: [163, 114, 69],
    loose: [201, 154, 90],
    rock: [118, 86, 63],
    ore: [194, 146, 53],
    peak: [224, 190, 142],
    basin: [124, 82, 52],
    waterDeep: [4, 46, 61],
    waterShallow: [38, 158, 158],
    surf: [168, 224, 214],
  },
  'frostbite-pass': {
    base: [206, 220, 224],
    loose: [152, 174, 181],
    rock: [96, 114, 128],
    ore: [199, 155, 64],
    peak: [244, 249, 252],
    basin: [140, 163, 176],
    waterDeep: [26, 50, 76],
    waterShallow: [110, 180, 200],
    surf: [206, 236, 244],
  },
};

export function renderTacticalMap(root: HTMLDivElement, options: TacticalMapOptions): void {
  const preset = MAP_PRESETS[options.mapId];
  const sizePreset = MAP_SIZE_PRESETS[options.mapSize];
  const raster = cachedRaster(
    options.mapId,
    options.mapSize,
    options.seed,
    options.oreAmount ?? DEFAULT_ORE_AMOUNT,
    options.terrainRelief,
  );

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
  heading.innerHTML = `<strong>${preset.shortLabel}</strong><span>${sizePreset.label} · ${raster.worldSize}M²</span>`;

  const telemetry = document.createElement('div');
  telemetry.className = 'tactical-map__telemetry';
  telemetry.innerHTML = [
    ['PEAK', `${Math.round(raster.maxHeight)}M`],
    ['WATER', `${Math.round(raster.waterCoverage * 100)}%`],
    ['OIL', `${raster.oreFields.length}`],
  ]
    .map(([key, value]) => `<span><small>${key}</small><b>${value}</b></span>`)
    .join('');

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

  const deployments = options.deployments ?? [];
  const markers = document.createElement('div');
  markers.className = 'tactical-map__deployments';
  const draggable = typeof options.onDeploymentMove === 'function';
  markers.classList.toggle('is-draggable', draggable);
  for (const deployment of deployments) {
    const spawn = deployment.point ?? defaultPointFor(raster.worldSize, deployment.army);
    const marker = document.createElement('div');
    marker.className = `tactical-map__deployment tactical-map__deployment--${deployment.army}`;
    marker.classList.toggle('is-local', Boolean(deployment.isLocal));
    marker.classList.toggle('is-open', Boolean(deployment.isOpen));
    positionMarker(marker, spawn);
    marker.style.setProperty('--deployment-color', deployment.color);
    marker.innerHTML =
      `<i>${deployment.army}</i>` +
      `<span><strong>${escapeMapText(deployment.label)}</strong>` +
      `<small>SIDE ${deployment.side}${deployment.detail ? ` · ${escapeMapText(deployment.detail)}` : ''}</small></span>`;
    if (draggable && !deployment.isOpen) {
      attachDeploymentDrag(marker, root, raster, deployment, deployments, options.onDeploymentMove!);
    }
    markers.appendChild(marker);
  }

  root.append(canvas, grid, heading, telemetry, north, markers, scale, legend);
}

function defaultPointFor(worldSize: number, army: number): SpawnPoint {
  const position = startPosition(worldSize, army);
  return { x: position.x / worldSize, z: position.z / worldSize };
}

function positionMarker(marker: HTMLElement, point: SpawnPoint): void {
  marker.style.left = `${(point.x + 0.5) * 100}%`;
  marker.style.top = `${(point.z + 0.5) * 100}%`;
  // Labels on the right half read outwards off the map, so mirror the chip.
  marker.classList.toggle('is-flipped', point.x > 0);
}

/**
 * Drags a start position around the map. The drop is rejected — and the marker
 * springs back — if it lands in water, on a cliff, or too near another army.
 */
function attachDeploymentDrag(
  marker: HTMLElement,
  root: HTMLElement,
  raster: TacticalMapRaster,
  deployment: TacticalMapDeployment,
  all: readonly TacticalMapDeployment[],
  commit: (army: number, point: SpawnPoint) => void,
): void {
  marker.classList.add('is-draggable');
  marker.tabIndex = 0;
  marker.setAttribute('role', 'button');
  marker.setAttribute('aria-label', `${deployment.label} start position. Drag to move.`);

  const origin = deployment.point ?? defaultPointFor(raster.worldSize, deployment.army);
  const others = all
    .filter((candidate) => candidate.army !== deployment.army && !candidate.isOpen)
    .map((candidate) => candidate.point ?? defaultPointFor(raster.worldSize, candidate.army));

  let pointerId: number | undefined;
  let valid = true;
  let current = origin;

  /** Where the pointer sat relative to the badge when the drag began. */
  let grab: SpawnPoint = { x: 0, z: 0 };

  const rawPointFromEvent = (event: PointerEvent): SpawnPoint => {
    const bounds = root.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width - 0.5,
      z: (event.clientY - bounds.top) / bounds.height - 0.5,
    };
  };

  const pointFromEvent = (event: PointerEvent): SpawnPoint => {
    const raw = rawPointFromEvent(event);
    return snapSpawnPoint({ x: raw.x - grab.x, z: raw.z - grab.z });
  };

  const evaluate = (point: SpawnPoint): boolean =>
    Math.abs(point.x) <= SPAWN_EDGE_LIMIT &&
    Math.abs(point.z) <= SPAWN_EDGE_LIMIT &&
    isPlaceableSpawn(raster, point) &&
    !others.some((other) => spawnPointsTooClose(point, other));

  marker.onpointerdown = (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    const raw = rawPointFromEvent(event);
    grab = { x: raw.x - current.x, z: raw.z - current.z };
    // Capture keeps the drag alive when the cursor outruns the marker.
    try {
      marker.setPointerCapture(event.pointerId);
    } catch {
      // Non-capturable pointer; the drag still tracks while over the map.
    }
    marker.classList.add('is-dragging');
    root.classList.add('is-placing');
    event.preventDefault();
  };

  marker.onpointermove = (event) => {
    if (event.pointerId !== pointerId) return;
    current = pointFromEvent(event);
    valid = evaluate(current);
    positionMarker(marker, current);
    marker.classList.toggle('is-invalid', !valid);
  };

  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;
    try {
      marker.releasePointerCapture(event.pointerId);
    } catch {
      // Capture was never granted.
    }
    marker.classList.remove('is-dragging', 'is-invalid');
    root.classList.remove('is-placing');
    if (valid && (current.x !== origin.x || current.z !== origin.z)) {
      commit(deployment.army, current);
    } else {
      positionMarker(marker, origin);
      current = origin;
    }
  };

  marker.onpointerup = finish;
  marker.onpointercancel = finish;

  // Keyboard nudging keeps the control usable without a pointer.
  marker.onkeydown = (event) => {
    const deltas: Record<string, SpawnPoint> = {
      ArrowLeft: { x: -1, z: 0 },
      ArrowRight: { x: 1, z: 0 },
      ArrowUp: { x: 0, z: -1 },
      ArrowDown: { x: 0, z: 1 },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = snapSpawnPoint({
      x: current.x + delta.x * SPAWN_GRID,
      z: current.z + delta.z * SPAWN_GRID,
    });
    if (!evaluate(next)) return;
    current = next;
    positionMarker(marker, next);
    commit(deployment.army, next);
  };
}

export function createTacticalMapRaster(
  mapId: MapId,
  mapSize: MapSize,
  seed: number,
  resolution = RASTER_SIZE,
  oreAmount = DEFAULT_ORE_AMOUNT,
  terrainRelief?: number,
): TacticalMapRaster {
  const config = { ...mapConfig(mapId, mapSize, oreAmount, terrainRelief), seed: Math.max(1, Math.floor(seed) || 1) };
  const hf = generateHeightfield(config);
  const width = Math.max(32, Math.floor(resolution));
  const pixels = new Uint8ClampedArray(width * width * 4);
  const palette = PALETTES[mapId];
  const metresPerPixel = hf.size / width;
  const dryRange = Math.max(1, hf.maxHeight - hf.waterLevel);

  // Resample the coarse heightfield up to raster resolution first. Catmull-Rom
  // rather than bilinear: hillshading differentiates this surface, and bilinear
  // has kinks at every source sample that show up as a diamond grid.
  const heights = new Float32Array(width * width);
  for (let py = 0; py < width; py++) {
    const v = (py / (width - 1)) * (hf.samples - 1);
    for (let px = 0; px < width; px++) {
      const u = (px / (width - 1)) * (hf.samples - 1);
      heights[py * width + px] = bicubic(hf.heights, hf.samples, u, v);
    }
  }
  // Just enough to clean up resampling artefacts. The terraced plateaus are a
  // real feature of these maps, so their cliffs are kept crisp.
  smooth(heights, width, 1);

  // Measure how steep this map actually is, then scale the normals so every
  // map lands in a readable shading range regardless of its relief setting.
  let slopeSquares = 0;
  let slopeCount = 0;
  for (let py = 1; py < width - 1; py += 2) {
    for (let px = 1; px < width - 1; px += 2) {
      const index = py * width + px;
      const dx = (heights[index + 1] - heights[index - 1]) / (2 * metresPerPixel);
      const dy = (heights[index + width] - heights[index - width]) / (2 * metresPerPixel);
      slopeSquares += dx * dx + dy * dy;
      slopeCount++;
    }
  }
  const rmsSlope = Math.sqrt(slopeSquares / Math.max(1, slopeCount));
  const exaggeration = clamp(TARGET_RMS_SLOPE / Math.max(1e-4, rmsSlope), 1, MAX_EXAGGERATION);

  // Aim for roughly a dozen contour bands whatever the elevation range is.
  const step = niceStep(dryRange / 12);

  let waterPixels = 0;

  for (let py = 0; py < width; py++) {
    const v = (py / (width - 1)) * (hf.samples - 1);
    for (let px = 0; px < width; px++) {
      const u = (px / (width - 1)) * (hf.samples - 1);
      const index = py * width + px;
      const pixelIndex = index * 4;
      const height = heights[index];
      const left = heights[index - (px > 0 ? 1 : 0)];
      const right = heights[index + (px < width - 1 ? 1 : 0)];
      const down = heights[index - (py > 0 ? width : 0)];
      const up = heights[index + (py < width - 1 ? width : 0)];

      // Central differences in metres of rise per metre travelled.
      const dzdx = (right - left) / (2 * metresPerPixel);
      const dzdy = (up - down) / (2 * metresPerPixel);

      if (height <= hf.waterLevel) {
        waterPixels++;
        const depth = clamp01((hf.waterLevel - height) / 14);
        let color = mixRgb(palette.waterShallow, palette.waterDeep, Math.pow(depth, 0.62));
        // Surf band hugging the coast, fading out into open water.
        const surf = 1 - smoothstep(0.0, 0.11, depth);
        color = mixRgb(color, palette.surf, surf * 0.5);
        // Water reads as a flat sheet, so it only picks up a faint sheen.
        const sheen = 1 + clamp(dzdx * 0.5 - dzdy * 0.5, -0.06, 0.06);
        writePixel(pixels, pixelIndex, color, sheen);
        continue;
      }

      const splat = bilinearSplat(hf.splat, hf.samples, u, v);
      let color = weightedRgb([palette.base, palette.loose, palette.rock, palette.ore], splat);

      // Elevation ramp: peaks bleach out, basins deepen. Reads as real terrain
      // instead of a flat splat map.
      const elevation = clamp01((height - hf.waterLevel) / dryRange);
      color = mixRgb(color, palette.peak, smoothstep(0.66, 1, elevation) * 0.34);
      color = mixRgb(color, palette.basin, (1 - smoothstep(0.0, 0.3, elevation)) * 0.34);

      // These maps are built from terraced plateaus, so the steep bands between
      // them are escarpments. Tint them toward bare rock so they read as cliffs
      // rather than as shadow smears.
      const steepness = Math.hypot(dzdx, dzdy) / Math.max(1e-4, rmsSlope);
      color = mixRgb(color, palette.rock, smoothstep(1.6, 4.5, steepness) * 0.55);

      // Lambertian relief shading against a north-west sun.
      const nx = -dzdx * exaggeration;
      const nz = -dzdy * exaggeration;
      const invLength = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      const lambert = clamp01((nx * LIGHT[0] + LIGHT[1] + nz * LIGHT[2]) * invLength);
      let shade = 0.58 + 0.62 * lambert;

      // Concave ground (gullies, crater floors) collects shadow. Normalised by
      // the map's own slope scale so it stays a hint rather than a hard band.
      const curvature = ((left + right + up + down) * 0.25 - height) / (rmsSlope * metresPerPixel + 1e-4);
      shade *= clamp(1 - curvature * 0.05, 0.93, 1.05);

      // Anti-aliased contour lines, emphasised every fifth interval.
      const bands = height / step;
      const distanceToLine = Math.min(bands - Math.floor(bands), Math.ceil(bands) - bands);
      const bandsPerPixel = Math.max(1e-4, Math.hypot(dzdx, dzdy) * metresPerPixel / step);
      const pixelsToLine = distanceToLine / bandsPerPixel;
      const major = Math.round(bands) % 5 === 0;
      const strength = (1 - smoothstep(0.3, 1.2, pixelsToLine)) * (major ? 0.19 : 0.1);
      shade *= 1 - strength;

      writePixel(pixels, pixelIndex, color, shade);
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
    placement: buildPlacementMask(heights, width, hf.waterLevel, metresPerPixel, rmsSlope),
    placementSize: PLACEMENT_SIZE,
  };
}

/**
 * Marks cells that could host a starting base. A cell fails if any of the
 * terrain it covers is under water or steep enough to be a cliff, so a dragged
 * marker cannot be dropped somewhere the base would slide off.
 */
function buildPlacementMask(
  heights: Float32Array,
  width: number,
  waterLevel: number,
  metresPerPixel: number,
  rmsSlope: number,
): Uint8Array {
  const mask = new Uint8Array(PLACEMENT_SIZE * PLACEMENT_SIZE);
  const stride = width / PLACEMENT_SIZE;
  const steepLimit = Math.max(0.35, rmsSlope * 3.4);
  for (let cy = 0; cy < PLACEMENT_SIZE; cy++) {
    const y0 = Math.floor(cy * stride);
    const y1 = Math.min(width - 1, Math.floor((cy + 1) * stride));
    for (let cx = 0; cx < PLACEMENT_SIZE; cx++) {
      const x0 = Math.floor(cx * stride);
      const x1 = Math.min(width - 1, Math.floor((cx + 1) * stride));
      let ok = 1;
      for (let y = y0; y <= y1 && ok; y++) {
        for (let x = x0; x <= x1; x++) {
          const index = y * width + x;
          if (heights[index] <= waterLevel + 0.75) {
            ok = 0;
            break;
          }
          const dx = (heights[index + (x < width - 1 ? 1 : 0)] - heights[index - (x > 0 ? 1 : 0)]) / (2 * metresPerPixel);
          const dy = (heights[index + (y < width - 1 ? width : 0)] - heights[index - (y > 0 ? width : 0)]) / (2 * metresPerPixel);
          if (Math.hypot(dx, dy) > steepLimit) {
            ok = 0;
            break;
          }
        }
      }
      mask[cy * PLACEMENT_SIZE + cx] = ok;
    }
  }
  return mask;
}

/** True when a normalised spawn offset lands on dry, buildable ground. */
export function isPlaceableSpawn(raster: TacticalMapRaster, point: { x: number; z: number }): boolean {
  const size = raster.placementSize;
  const cx = Math.floor(clamp((point.x + 0.5) * size, 0, size - 1));
  const cy = Math.floor(clamp((point.z + 0.5) * size, 0, size - 1));
  return raster.placement[cy * size + cx] === 1;
}

export function worldToMapPercent(worldSize: number, x: number, z: number): { x: number; y: number } {
  const half = Math.max(1, worldSize) / 2;
  return {
    x: clamp(((x + half) / (half * 2)) * 100, 0, 100),
    y: clamp(((z + half) / (half * 2)) * 100, 0, 100),
  };
}

export function mapPercentToWorld(worldSize: number, percentX: number, percentY: number): { x: number; z: number } {
  const half = Math.max(1, worldSize) / 2;
  return {
    x: clamp((percentX / 100) * half * 2 - half, -half, half),
    z: clamp((percentY / 100) * half * 2 - half, -half, half),
  };
}

/** Cached raster for a map configuration, for callers that need to validate placement. */
export function tacticalMapRaster(options: TacticalMapOptions): TacticalMapRaster {
  return cachedRaster(
    options.mapId,
    options.mapSize,
    options.seed,
    options.oreAmount ?? DEFAULT_ORE_AMOUNT,
    options.terrainRelief,
  );
}

function cachedRaster(mapId: MapId, mapSize: MapSize, seed: number, oreAmount: number, terrainRelief?: number): TacticalMapRaster {
  const safeSeed = Math.max(1, Math.floor(seed) || 1);
  const key = `${mapId}:${mapSize}:${safeSeed}:${oreAmount}:${terrainRelief ?? 'default'}`;
  const cached = rasterCache.get(key);
  if (cached) return cached;
  const raster = createTacticalMapRaster(mapId, mapSize, safeSeed, RASTER_SIZE, oreAmount, terrainRelief);
  rasterCache.set(key, raster);
  if (rasterCache.size > MAX_CACHE_ENTRIES) {
    const oldest = rasterCache.keys().next().value;
    if (oldest) rasterCache.delete(oldest);
  }
  return raster;
}

/**
 * Ore fields read as surveyed deposits: a speckled patch of grains inside a
 * dashed claim ring, rather than a glowing blob.
 */
function drawOreFields(context: CanvasRenderingContext2D, raster: TacticalMapRaster): void {
  const scale = raster.width / raster.worldSize;
  const unit = raster.width / 512;
  context.save();
  for (const field of raster.oreFields) {
    const point = worldToMapPercent(raster.worldSize, field.x, field.z);
    const x = (point.x / 100) * raster.width;
    const y = (point.y / 100) * raster.height;
    const radius = Math.max(7 * unit, field.radius * scale);
    const random = seededRandom(Math.round(field.x * 73 + field.z * 31 + field.radius * 17));

    // Soft ground stain so the patch separates from the terrain beneath it.
    const stain = context.createRadialGradient(x, y, radius * 0.15, x, y, radius);
    stain.addColorStop(0, 'rgba(214,161,44,.42)');
    stain.addColorStop(0.6, 'rgba(198,146,38,.2)');
    stain.addColorStop(1, 'rgba(190,140,36,0)');
    context.fillStyle = stain;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();

    // Ore grains, denser toward the centre of the deposit.
    const grains = Math.round(clamp(radius * 0.9, 14, 60));
    for (let index = 0; index < grains; index++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius * 0.86;
      const gx = x + Math.cos(angle) * distance;
      const gy = y + Math.sin(angle) * distance;
      const falloff = 1 - distance / (radius * 0.86);
      context.fillStyle = `rgba(255,214,96,${(0.3 + falloff * 0.55).toFixed(3)})`;
      context.beginPath();
      context.arc(gx, gy, unit * (0.6 + random() * 0.9), 0, Math.PI * 2);
      context.fill();
    }

    // Dashed claim ring marking the surveyed extent.
    context.strokeStyle = 'rgba(255,216,104,.62)';
    context.lineWidth = Math.max(1, unit * 0.9);
    context.setLineDash([unit * 3, unit * 3]);
    context.beginPath();
    context.arc(x, y, radius * 0.88, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}

function seededRandom(seed: number): () => number {
  let state = (Math.abs(Math.floor(seed)) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function scaleLength(worldSize: number): number {
  if (worldSize >= 1200) return 300;
  if (worldSize >= 900) return 200;
  return 150;
}

/** Rounds a contour interval to the nearest 1/2/5 × 10ⁿ, as survey maps do. */
function niceStep(raw: number): number {
  const target = Math.max(0.5, raw);
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  const normalized = target / magnitude;
  const rounded = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return rounded * magnitude;
}

function writePixel(pixels: Uint8ClampedArray, offset: number, color: Rgb, shade: number): void {
  pixels[offset] = clampByte(color[0] * shade);
  pixels[offset + 1] = clampByte(color[1] * shade);
  pixels[offset + 2] = clampByte(color[2] * shade);
  pixels[offset + 3] = 255;
}

/** Catmull-Rom sample of a square grid; C1 continuous, so derivatives stay smooth. */
function bicubic(values: Float32Array, samples: number, u: number, v: number): number {
  const x = Math.floor(u);
  const y = Math.floor(v);
  const fx = u - x;
  const fy = v - y;
  const rows: number[] = [];
  for (let row = -1; row <= 2; row++) {
    const sy = clamp(y + row, 0, samples - 1) * samples;
    rows.push(
      cubic(
        values[sy + clamp(x - 1, 0, samples - 1)],
        values[sy + clamp(x, 0, samples - 1)],
        values[sy + clamp(x + 1, 0, samples - 1)],
        values[sy + clamp(x + 2, 0, samples - 1)],
        fx,
      ),
    );
  }
  return cubic(rows[0], rows[1], rows[2], rows[3], fy);
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const p = d - c - (a - b);
  return p * t * t * t + (a - b - p) * t * t + (c - a) * t + b;
}

/** In-place separable box blur, repeated to approximate a Gaussian. */
function smooth(values: Float32Array, width: number, radius: number): void {
  if (radius < 1) return;
  const scratch = new Float32Array(values.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        let total = 0;
        let count = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const sx = x + offset;
          if (sx < 0 || sx >= width) continue;
          total += values[y * width + sx];
          count++;
        }
        scratch[y * width + x] = total / count;
      }
    }
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        let total = 0;
        let count = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const sy = y + offset;
          if (sy < 0 || sy >= width) continue;
          total += scratch[sy * width + x];
          count++;
        }
        values[y * width + x] = total / count;
      }
    }
  }
}

function bilinearSplat(splat: Uint8Array, samples: number, u: number, v: number): readonly number[] {
  const x0 = Math.min(samples - 1, Math.floor(u));
  const y0 = Math.min(samples - 1, Math.floor(v));
  const x1 = Math.min(samples - 1, x0 + 1);
  const y1 = Math.min(samples - 1, y0 + 1);
  const fx = u - x0;
  const fy = v - y0;
  const weights: number[] = [];
  for (let channel = 0; channel < 4; channel++) {
    const top =
      splat[(y0 * samples + x0) * 4 + channel] * (1 - fx) + splat[(y0 * samples + x1) * 4 + channel] * fx;
    const bottom =
      splat[(y1 * samples + x0) * 4 + channel] * (1 - fx) + splat[(y1 * samples + x1) * 4 + channel] * fx;
    weights.push((top * (1 - fy) + bottom * fy) / 255);
  }
  return weights;
}

function normalize(vector: Rgb): Rgb {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
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
