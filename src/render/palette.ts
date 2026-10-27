import type { ArmyDoctrineId } from '../content/armyDoctrines';
import { nationsForDoctrines, type NationId } from '../content/nations';

export interface FactionPalette {
  accent: number;
  accentEmissive: number;
  hull: number;
  hullDark: number;
  canvas: number;
  lightBar: number;
}

export type FactionId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ARMY_COLOR_FAMILIES = {
  aegisBlue: {
    accent: 0x1677ff,
    accentEmissive: 0x001b4f,
    hull: 0x426f9c,
    hullDark: 0x203d61,
    canvas: 0x315977,
    lightBar: 0x8fd8ff,
  },
  israelBlue: {
    // Sinai-grey armor carrying IDF flag-blue markings and white light bars.
    accent: 0x2f7dff,
    accentEmissive: 0x001b4f,
    hull: 0x6f7c88,
    hullDark: 0x38434f,
    canvas: 0x5e6b76,
    lightBar: 0xdcecff,
  },
  vesperRed: {
    accent: 0xe0443e,
    accentEmissive: 0x3b0503,
    hull: 0x81504d,
    hullDark: 0x472a2c,
    canvas: 0x643b3a,
    lightBar: 0xff9b91,
  },
  coalitionGreen: {
    accent: 0x35c878,
    accentEmissive: 0x062e18,
    hull: 0x47765c,
    hullDark: 0x294735,
    canvas: 0x365f48,
    lightBar: 0x9af1bd,
  },
  coalitionViolet: {
    accent: 0xa26bff,
    accentEmissive: 0x210945,
    hull: 0x6b5982,
    hullDark: 0x3d3152,
    canvas: 0x554667,
    lightBar: 0xd7b8ff,
  },
  coalitionAmber: {
    accent: 0xe9a83f,
    accentEmissive: 0x3b2104,
    hull: 0x806743,
    hullDark: 0x4a3923,
    canvas: 0x665132,
    lightBar: 0xffd88a,
  },
} as const satisfies Record<string, FactionPalette>;

const DEFAULT_TEAM_PALETTES: Record<FactionId, FactionPalette> = {
  1: ARMY_COLOR_FAMILIES.israelBlue,
  2: ARMY_COLOR_FAMILIES.vesperRed,
  3: ARMY_COLOR_FAMILIES.coalitionAmber,
  4: ARMY_COLOR_FAMILIES.coalitionGreen,
  5: ARMY_COLOR_FAMILIES.coalitionViolet,
  6: { ...ARMY_COLOR_FAMILIES.aegisBlue, accent: 0x35cacc, lightBar: 0x9aeeee },
  7: { ...ARMY_COLOR_FAMILIES.vesperRed, accent: 0xec77bc, lightBar: 0xffbce6 },
};

export const FACTION: Record<FactionId, FactionPalette> = Object.fromEntries(
  Object.entries(DEFAULT_TEAM_PALETTES).map(([id, palette]) => [id, { ...palette }]),
) as Record<FactionId, FactionPalette>;

const PLAYER_COLORS = {
  jade: { accent: 0x67d59b, accentEmissive: 0x063020, lightBar: 0xb6ffd4 },
  crimson: { accent: 0xed6a5c, accentEmissive: 0x340806, lightBar: 0xffb1a6 },
  azure: { accent: 0x67b8ef, accentEmissive: 0x061d38, lightBar: 0xb9e4ff },
  amber: { accent: 0xe8b854, accentEmissive: 0x382405, lightBar: 0xffe7a4 },
} as const;

const NATION_COLORS: Record<NationId, FactionPalette> = {
  israel: ARMY_COLOR_FAMILIES.israelBlue,
  usa: ARMY_COLOR_FAMILIES.coalitionViolet,
  uk: ARMY_COLOR_FAMILIES.coalitionGreen,
  france: ARMY_COLOR_FAMILIES.coalitionAmber,
  iran: ARMY_COLOR_FAMILIES.vesperRed,
  hezbollah: ARMY_COLOR_FAMILIES.coalitionAmber,
  houthis: ARMY_COLOR_FAMILIES.coalitionGreen,
  'iraqi-militias': ARMY_COLOR_FAMILIES.coalitionViolet,
};

/**
 * Assigns one visual identity per alliance side from its first army's nation:
 * Israel blue, Iran red, Hezbollah yellow, Houthis green. Armies sharing a
 * side always share their colors; a clash falls back to an unused family.
 */
export function armyFactionPalettes(
  doctrines: readonly ArmyDoctrineId[],
  sides: readonly number[],
): FactionPalette[] {
  const count = Math.min(7, Math.max(doctrines.length, sides.length));
  if (count === 0) return [];
  const groups = new Map<number, number[]>();
  for (let index = 0; index < count; index++) {
    const rawSide = Math.floor(Number(sides[index]));
    const side = Number.isFinite(rawSide) && rawSide > 0 ? rawSide : index + 1;
    const members = groups.get(side) ?? [];
    members.push(index);
    groups.set(side, members);
  }

  const nations = nationsForDoctrines(doctrines.slice(0, count));
  const assigned: FactionPalette[] = [];
  const used = new Set<FactionPalette>();
  const fallbacks = [...Object.values(ARMY_COLOR_FAMILIES), DEFAULT_TEAM_PALETTES[6], DEFAULT_TEAM_PALETTES[7]] as FactionPalette[];
  for (const members of groups.values()) {
    // Allies share the colors of the side's first nation.
    const preferred = NATION_COLORS[nations[members[0]] ?? 'israel'];
    const palette = used.has(preferred) ? fallbacks.find((family) => !used.has(family)) ?? preferred : preferred;
    used.add(palette);
    for (const member of members) assigned[member] = { ...palette };
  }
  return assigned;
}

/** Applies doctrine/side colors before world views create their materials. */
export function applyArmyFactionColors(doctrines: readonly ArmyDoctrineId[], sides: readonly number[]): void {
  for (const id of [1, 2, 3, 4, 5, 6, 7] as FactionId[]) Object.assign(FACTION[id], DEFAULT_TEAM_PALETTES[id]);
  const palettes = armyFactionPalettes(doctrines, sides);
  for (let index = 0; index < palettes.length; index++) Object.assign(FACTION[(index + 1) as FactionId], palettes[index]);
}

/** Retained for player-authored multiplayer color overrides. */
export function applyMultiplayerFactionColors(colors: Partial<Record<number, keyof typeof PLAYER_COLORS>> = {}): void {
  for (const [team, color] of Object.entries(colors)) {
    const id = Number(team) as FactionId;
    if (!FACTION[id] || !color || !PLAYER_COLORS[color]) continue;
    Object.assign(FACTION[id], PLAYER_COLORS[color]);
  }
}

export function factionCamoColors(id: FactionId): string[] {
  const palette = FACTION[id];
  return [
    colorCss(palette.canvas),
    colorCss(blendHex(palette.canvas, palette.hull, 0.55)),
    colorCss(palette.hullDark),
    colorCss(blendHex(palette.hull, palette.accent, 0.28)),
  ];
}

export function factionId(teamId: number | undefined): FactionId {
  return teamId !== undefined && Number.isInteger(teamId) && teamId >= 1 && teamId <= 7 ? teamId as FactionId : 1;
}

export function colorCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function blendHex(from: number, to: number, amount: number): number {
  const mix = (shift: number): number => Math.round(((from >> shift) & 0xff) * (1 - amount) + ((to >> shift) & 0xff) * amount);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
