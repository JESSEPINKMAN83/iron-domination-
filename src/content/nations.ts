import { defaultArmyDoctrines, type ArmyDoctrineId } from './armyDoctrines';

// Code Red identity layer. Doctrines stay the gameplay source of truth; a
// nation is only the name a player sees for an army. The first air-force army
// is Israel, the first missile army is Iran, and further armies of the same
// doctrine take the next ally/proxy name in order.
export type NationId =
  | 'israel'
  | 'usa'
  | 'uk'
  | 'france'
  | 'iran'
  | 'hezbollah'
  | 'houthis'
  | 'iraqi-militias';

export interface NationDef {
  id: NationId;
  name: string;
  /** Upper-case form for HUD chips and banners. */
  tag: string;
  doctrine: ArmyDoctrineId;
}

export const NATIONS: Record<NationId, NationDef> = {
  israel: { id: 'israel', name: 'Israel', tag: 'ISRAEL', doctrine: 'iron-legion' },
  usa: { id: 'usa', name: 'United States', tag: 'UNITED STATES', doctrine: 'iron-legion' },
  uk: { id: 'uk', name: 'United Kingdom', tag: 'UNITED KINGDOM', doctrine: 'iron-legion' },
  france: { id: 'france', name: 'France', tag: 'FRANCE', doctrine: 'iron-legion' },
  iran: { id: 'iran', name: 'Iran', tag: 'IRAN', doctrine: 'missile-command' },
  hezbollah: { id: 'hezbollah', name: 'Hezbollah', tag: 'HEZBOLLAH', doctrine: 'missile-command' },
  houthis: { id: 'houthis', name: 'Houthis', tag: 'HOUTHIS', doctrine: 'missile-command' },
  'iraqi-militias': { id: 'iraqi-militias', name: 'Iraqi Militias', tag: 'IRAQI MILITIAS', doctrine: 'missile-command' },
};

const NATION_ORDER: Record<ArmyDoctrineId, readonly NationId[]> = {
  'iron-legion': ['israel', 'usa', 'uk', 'france'],
  'missile-command': ['iran', 'hezbollah', 'houthis', 'iraqi-militias'],
};

/** Nation for each army (index 0 = army 1), assigned by doctrine order. */
export function nationsForDoctrines(doctrines: readonly ArmyDoctrineId[]): NationId[] {
  const used: Record<ArmyDoctrineId, number> = { 'iron-legion': 0, 'missile-command': 0 };
  return doctrines.slice(0, 4).map((doctrine) => {
    const order = NATION_ORDER[doctrine];
    return order[Math.min(order.length - 1, used[doctrine]++)];
  });
}

let activeNations: NationId[] = nationsForDoctrines(defaultArmyDoctrines());

/** Called once per match before any UI reads army names. */
export function applyArmyNations(doctrines: readonly ArmyDoctrineId[], overrides: Partial<Record<number,NationId>> = {}): void {
  activeNations = nationsForDoctrines(doctrines).map((nation,index)=>overrides[index+1] ?? nation);
}

export function nationForTeam(team: number | undefined): NationDef | undefined {
  if (team === undefined || !Number.isInteger(team) || team < 1) return undefined;
  const id = activeNations[team - 1];
  return id ? NATIONS[id] : undefined;
}

/** Display name for an army, e.g. "Hezbollah". */
export function armyName(team: number | undefined): string {
  return nationForTeam(team)?.name ?? `Army ${team ?? '?'}`;
}

/** Upper-case display name for HUD chips, e.g. "HEZBOLLAH". */
export function armyTag(team: number | undefined): string {
  return nationForTeam(team)?.tag ?? `ARMY ${team ?? '?'}`;
}
