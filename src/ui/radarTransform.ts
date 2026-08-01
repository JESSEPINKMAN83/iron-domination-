export interface RadarPoint {
  x: number;
  y: number;
}

export interface RadarWorldPoint {
  x: number;
  z: number;
  inside: boolean;
}

export interface RadarTransformMetrics {
  centerX: number;
  centerY: number;
  drawSize: number;
  cos: number;
  sin: number;
}

export type RadarPointerAction = 'focus' | 'move' | 'attack-ground' | 'ignore';

export function radarPointerAction(button: number, metaKey: boolean): RadarPointerAction {
  if (button === 0) return 'focus';
  if (button === 2) return metaKey ? 'attack-ground' : 'move';
  return 'ignore';
}

/**
 * Keeps the full square battlefield visible while rotating it camera-up.
 * At diagonal headings the map becomes a fitted diamond instead of clipping
 * its corners, which keeps strategic information and tap targets available.
 */
export function radarTransformMetrics(width: number, height: number, yaw: number): RadarTransformMetrics {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const fit = 1 / Math.max(1, Math.abs(cos) + Math.abs(sin));
  return {
    centerX: width / 2,
    centerY: height / 2,
    drawSize: Math.max(1, Math.min(width, height) * fit),
    cos,
    sin,
  };
}

/** Camera forward is always radar-up and camera right is always radar-right. */
export function worldToRadarPoint(
  worldSize: number,
  width: number,
  height: number,
  x: number,
  z: number,
  yaw: number,
): RadarPoint {
  const metrics = radarTransformMetrics(width, height, yaw);
  const scale = metrics.drawSize / Math.max(1, worldSize);
  return {
    x: metrics.centerX + (x * metrics.cos - z * metrics.sin) * scale,
    y: metrics.centerY + (x * metrics.sin + z * metrics.cos) * scale,
  };
}

/** Exact inverse of worldToRadarPoint, with map-edge clamping for touch taps. */
export function radarToWorldPoint(
  worldSize: number,
  width: number,
  height: number,
  radarX: number,
  radarY: number,
  yaw: number,
): RadarWorldPoint {
  const metrics = radarTransformMetrics(width, height, yaw);
  const inverseScale = Math.max(1, worldSize) / metrics.drawSize;
  const localX = (radarX - metrics.centerX) * inverseScale;
  const localY = (radarY - metrics.centerY) * inverseScale;
  const rawX = localX * metrics.cos + localY * metrics.sin;
  const rawZ = -localX * metrics.sin + localY * metrics.cos;
  const half = Math.max(1, worldSize) / 2;
  return {
    x: clamp(rawX, -half, half),
    z: clamp(rawZ, -half, half),
    inside: Math.abs(rawX) <= half && Math.abs(rawZ) <= half,
  };
}

/** Direction of true north (+Z) after the camera-up transform. */
export function radarNorthDirection(yaw: number): RadarPoint {
  return { x: -Math.sin(yaw), y: Math.cos(yaw) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
