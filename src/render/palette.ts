import type { ArmyDoctrineId } from '../content/armyDoctrines';

export interface FactionPalette {
  accent: number;
  accentEmissive: number;
  hull: number;
  hullDark: number;
  canvas: number;
  lightBar: number;
}

export type FactionId = 1 | 2 | 3 | 4;

export const ARMY_COLOR_FAMILIES = {
  aegisBlue: {
    accent: 0x1677ff,
    accentEmissive: 0x001b4f,
    hull: 0x426f9c,
    hullDark: 0x203d61,
    canvas: 0x315977,
    lightBar: 0x8fd8ff,
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
  1: ARMY_COLOR_FAMILIES.aegisBlue,
  2: ARMY_COLOR_FAMILIES.vesperRed,
  3: ARMY_COLOR_FAMILIES.coalitionGreen,
  4: ARMY_COLOR_FAMILIES.coalitionViolet,
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

/**
 * Assigns one visual identity per alliance side. The first Aegis side receives
 * blue, the first Vesper side red, and additional hostile sides receive stable
 * green/violet identities. Armies sharing a side always share their colors.
 */
export function armyFactionPalettes(
  doctrines: readonly ArmyDoctrineId[],
  sides: readonly number[],
): FactionPalette[] {
  const count = Math.min(4, Math.max(doctrines.length, sides.length));
  if (count === 0) return [];
  const groups = new Map<number, number[]>();
  for (let index = 0; index < count; index++) {
    const rawSide = Math.floor(Number(sides[index]));
    const side = Number.isFinite(rawSide) && rawSide > 0 ? rawSide : index + 1;
    const members = groups.get(side) ?? [];
    members.push(index);
    groups.set(side, members);
  }

  const assigned: FactionPalette[] = [];
  let blueUsed = false;
  let redUsed = false;
  const extras = [
    ARMY_COLOR_FAMILIES.coalitionGreen,
    ARMY_COLOR_FAMILIES.coalitionViolet,
    ARMY_COLOR_FAMILIES.coalitionAmber,
  ];
  let extraIndex = 0;
  for (const members of groups.values()) {
    const groupDoctrines = members.map((index) => doctrines[index]);
    let palette: FactionPalette;
    if (!blueUsed && groupDoctrines.includes('iron-legion')) {
      palette = ARMY_COLOR_FAMILIES.aegisBlue;
      blueUsed = true;
    } else if (!redUsed && groupDoctrines.includes('missile-command')) {
      palette = ARMY_COLOR_FAMILIES.vesperRed;
      redUsed = true;
    } else {
      palette = extras[Math.min(extraIndex++, extras.length - 1)];
    }
    for (const member of members) assigned[member] = { ...palette };
  }
  return assigned;
}

/** Applies doctrine/side colors before world views create their materials. */
export function applyArmyFactionColors(doctrines: readonly ArmyDoctrineId[], sides: readonly number[]): void {
  for (const id of [1, 2, 3, 4] as FactionId[]) Object.assign(FACTION[id], DEFAULT_TEAM_PALETTES[id]);
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
  return teamId === 2 || teamId === 3 || teamId === 4 ? teamId : 1;
}

export function colorCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function blendHex(from: number, to: number, amount: number): number {
  const mix = (shift: number): number => Math.round(((from >> shift) & 0xff) * (1 - amount) + ((to >> shift) & 0xff) * amount);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
