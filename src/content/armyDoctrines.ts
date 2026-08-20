export const ARMY_DOCTRINE_IDS = ['iron-legion', 'missile-command'] as const;

export type ArmyDoctrineId = (typeof ARMY_DOCTRINE_IDS)[number];

export interface ArmyDoctrineDef {
  id: ArmyDoctrineId;
  label: string;
  specialty: string;
  description: string;
}

export const ARMY_DOCTRINES: Record<ArmyDoctrineId, ArmyDoctrineDef> = {
  'iron-legion': {
    id: 'iron-legion',
    label: 'Iron Legion',
    specialty: 'Combined arms',
    description: 'The current balanced army: strong armor, flexible aircraft, and dependable defenses.',
  },
  'missile-command': {
    id: 'missile-command',
    label: 'Missile Command',
    specialty: 'Long-range strike',
    description: 'Build intelligence infrastructure, reveal enemy structures, and strike them from across the map.',
  },
};

export function sanitizeArmyDoctrine(value: unknown): ArmyDoctrineId | undefined {
  return ARMY_DOCTRINE_IDS.includes(value as ArmyDoctrineId) ? value as ArmyDoctrineId : undefined;
}
