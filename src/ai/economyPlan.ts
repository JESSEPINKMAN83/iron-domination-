import type { Entity } from '../sim/components';

/** An economy needs another forward refinery if none has useful ore nearby. */
export function needsForwardRefinery(refineries: readonly Entity[], nodes: readonly { x: number; z: number; radius: number; remaining: number; capacity: number }[], limit: number): boolean {
  if (refineries.length === 0 || refineries.length >= limit) return false;
  const useful = nodes.filter(n => n.remaining > Math.max(1, n.capacity * 0.08));
  return useful.length > 0 && !useful.some(node => refineries.some(r => Math.hypot(r.transform.x - node.x, r.transform.z - node.z) < node.radius + 95));
}

/** Grow collector throughput gradually, without expanding past the remaining ore supply. */
export function needsEconomyScale(refineryCount: number, elapsed: number, remainingOre: number): boolean {
  const desired = Math.min(6, 2 + Math.floor(Math.max(0, elapsed) / 120));
  return refineryCount > 0 && refineryCount < desired && remainingOre > refineryCount * 1800;
}
