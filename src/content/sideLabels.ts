import type { ArmyDoctrineId } from './armyDoctrines';
import { nationForTeam } from './nations';
import { STRUCTURES, UNITS, type StructureKind, type UnitKind } from './phase3';

// Code Red display names. Both doctrines share the ground roster, so the same
// unit kind reads as the Israeli or Iranian equivalent depending on its army.
// Ids, entity names and gameplay are untouched — this is presentation only.
const UNIT_LABELS: Record<ArmyDoctrineId, Partial<Record<UnitKind, string>>> = {
  'iron-legion': {
    infantry: 'Golani Infantry',
    sniper: 'Sayeret Sniper',
    grenadier: 'Paratroopers',
    'rocket-infantry': 'Spike ATGM Team',
    'scout-tank': 'Eitan APC',
    tank: 'Merkava Mk4',
    'siege-tank': 'Rochev Howitzer',
    artillery:'ATMOS Field Gun',
    wasp: 'AH-1 Cobra',
    vulture: 'AH-64 Apache',
    hammerhead: 'Yasur Strike Gunship',
  },
  'missile-command': {
    infantry: 'IRGC Infantry',
    sniper: 'IRGC Sniper',
    grenadier: 'IRGC Grenadiers',
    'rocket-infantry': 'Toophan ATGM Team',
    'scout-tank': 'Rakhsh APC',
    tank: 'Karrar Tank',
    'siege-tank': 'Fajr Rocket Artillery',
    artillery:'Raad Field Gun',
  },
};

const STRUCTURE_LABELS: Record<ArmyDoctrineId, Partial<Record<StructureKind, string>>> = {
  'iron-legion': {
    barracks: 'IDF Barracks',
    factory: 'Armor Works',
    'guard-tower': 'Border Outpost',
    'aa-tower': 'Iron Dome Battery',
    wall: 'Concrete Barrier',
  },
  'missile-command': {
    barracks: 'IRGC Barracks',
    factory: 'Armor Works',
    'guard-tower': 'Border Outpost',
    'aa-tower': 'Khordad-15 SAM',
    wall: 'Concrete Barrier',
  },
};

const BASE_UNIT_LABELS = Object.fromEntries(
  Object.entries(UNITS).map(([kind, def]) => [kind, def.label]),
) as Record<UnitKind, string>;
const BASE_STRUCTURE_LABELS = Object.fromEntries(
  Object.entries(STRUCTURES).map(([kind, def]) => [kind, def.label]),
) as Record<StructureKind, string>;

let localDoctrine: ArmyDoctrineId = 'iron-legion';

function doctrineFor(team: number | undefined): ArmyDoctrineId {
  return nationForTeam(team)?.doctrine ?? localDoctrine;
}

export function unitLabel(kind: UnitKind, team?: number): string {
  return UNIT_LABELS[doctrineFor(team)][kind] ?? BASE_UNIT_LABELS[kind];
}

export function structureLabel(kind: StructureKind, team?: number): string {
  return STRUCTURE_LABELS[doctrineFor(team)][kind] ?? BASE_STRUCTURE_LABELS[kind];
}

/**
 * Build menus, tooltips and the field guide read UNITS/STRUCTURES labels
 * directly; point them at the local player's side for this match.
 */
export function applyLocalSideLabels(doctrine: ArmyDoctrineId): void {
  localDoctrine = doctrine;
  for (const kind of Object.keys(UNITS) as UnitKind[]) UNITS[kind].label = unitLabel(kind);
  for (const kind of Object.keys(STRUCTURES) as StructureKind[]) STRUCTURES[kind].label = structureLabel(kind);
}
