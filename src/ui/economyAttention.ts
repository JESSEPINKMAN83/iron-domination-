import type { Entity } from '../sim/components';
import type { ResourceNode } from '../sim/world';

/** Only report fields assigned to our collectors, never hidden enemy resources. */
export function economyAttention(harvesters: Entity[], nodes: ResourceNode[]): { text: string; target?: { x: number; z: number } } {
  const idle = harvesters.filter((entity) => entity.harvester?.state === 'seeking');
  if (idle.length > 0) return {
    text: `${idle.length} IDLE COLLECTOR${idle.length === 1 ? '' : 'S'} · LOCATE`,
    target: idle[0].transform,
  };
  const assigned = new Set(harvesters.map((entity) => entity.harvester?.nodeId));
  const low = nodes.filter((node) => assigned.has(node.id) && node.capacity > 0 && node.remaining / node.capacity <= 0.15);
  if (low.length > 0) return {
    text: `${low.length} ASSIGNED FIELD${low.length === 1 ? '' : 'S'} NEARLY EMPTY · LOCATE`,
    target: { x: low[0].x, z: low[0].z },
  };
  return { text: '' };
}

/** Track transitions so new, already idle factories do not generate alerts. */
export class ProductionIdleTracker {
  private busy = new Set<number>();

  update(producers: { id: number; label: string; busy: boolean }[]): string[] {
    const idle = producers.filter((producer) => !producer.busy && this.busy.has(producer.id));
    this.busy = new Set(producers.filter((producer) => producer.busy).map((producer) => producer.id));
    return idle.map((producer) => producer.label);
  }
}
