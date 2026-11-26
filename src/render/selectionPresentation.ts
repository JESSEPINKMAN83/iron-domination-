/** Screen-sized assistance stays bounded while following the unit's visible size. */
export function selectionPickRadius(worldRadius: number, distance: number, projectionScale: number, viewportHeight: number, infantry: boolean): number {
  const projected = Math.max(0, worldRadius) * Math.abs(projectionScale) * viewportHeight / (2 * Math.max(1, distance));
  return Math.max(infantry ? 14 : 18, Math.min(84, projected * 1.25));
}

export function selectionRingScale(radius: number, distance: number, projectionScale: number, viewportHeight: number): number {
  const pixels = radius * Math.abs(projectionScale) * viewportHeight / (2 * Math.max(1, distance));
  return Math.max(1, Math.min(3, 8 / Math.max(0.1, pixels)));
}
