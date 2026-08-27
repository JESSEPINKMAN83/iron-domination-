export const ARMY_DOCTRINE_IDS = ['iron-legion', 'missile-command'] as const;

export type ArmyDoctrineId = (typeof ARMY_DOCTRINE_IDS)[number];
export type ArmyDoctrineAssignments = [ArmyDoctrineId, ArmyDoctrineId, ArmyDoctrineId, ArmyDoctrineId];

export interface ArmyDoctrineDef {
  id: ArmyDoctrineId;
  label: string;
  specialty: string;
  description: string;
  strength: string;
  limitation: string;
}

export const ARMY_DOCTRINES: Record<ArmyDoctrineId, ArmyDoctrineDef> = {
  'iron-legion': {
    id: 'iron-legion',
    label: 'Aegis Coalition',
    specialty: 'Air superiority & interception',
    description: 'Control the sky with aircraft and layered missile-defense batteries.',
    strength: 'Aircraft and strategic missile interception',
    limitation: 'No strategic missile program',
  },
  'missile-command': {
    id: 'missile-command',
    label: 'Vesper Republic',
    specialty: 'Long-range strategic strike',
    description: 'Build intelligence and missile infrastructure, then strike marked locations across the map.',
    strength: 'Long-range warheads and precision guidance',
    limitation: 'No helipads or aircraft production',
  },
};

export function opposingArmyDoctrine(doctrine: ArmyDoctrineId): ArmyDoctrineId {
  return doctrine === 'iron-legion' ? 'missile-command' : 'iron-legion';
}

export function sanitizeArmyDoctrine(value: unknown): ArmyDoctrineId | undefined {
  return ARMY_DOCTRINE_IDS.includes(value as ArmyDoctrineId) ? value as ArmyDoctrineId : undefined;
}

export function defaultArmyDoctrines(): ArmyDoctrineAssignments {
  return ['iron-legion', 'missile-command', 'missile-command', 'missile-command'];
}

export function sanitizeArmyDoctrines(value: unknown, legacyPrimary?: unknown): ArmyDoctrineAssignments | undefined {
  if (Array.isArray(value) && value.length > 0) {
    const defaults = defaultArmyDoctrines();
    return defaults.map((fallback, index) => sanitizeArmyDoctrine(value[index]) ?? fallback) as ArmyDoctrineAssignments;
  }
  const primary = sanitizeArmyDoctrine(legacyPrimary);
  if (!primary) return undefined;
  const opponent = opposingArmyDoctrine(primary);
  return [primary, opponent, opponent, opponent];
}
