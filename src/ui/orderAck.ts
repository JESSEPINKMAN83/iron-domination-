export type OrderAckKind = 'select' | 'move' | 'attack' | 'stop';

const LABELS: Record<OrderAckKind, string> = {
  select: 'Standing by',
  move: 'Moving out',
  attack: 'Weapons free',
  stop: 'Holding position',
};

export function orderAckLabel(kind: OrderAckKind): string {
  return LABELS[kind];
}

/** Map world order markers onto acknowledgement kinds. */
export function orderAckFromMarker(kind: string): OrderAckKind | undefined {
  if (kind === 'attack' || kind === 'attack-move') return 'attack';
  if (kind === 'move') return 'move';
  return undefined;
}
