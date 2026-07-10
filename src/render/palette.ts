export interface FactionPalette {
  accent: number;
  accentEmissive: number;
  hull: number;
  hullDark: number;
  canvas: number;
  lightBar: number;
}

export const FACTION: Record<1 | 2 | 3 | 4, FactionPalette> = {
  1: {
    accent: 0xf0c85a,
    accentEmissive: 0x2b1d00,
    hull: 0x65787f,
    hullDark: 0x3f535a,
    canvas: 0x55603f,
    lightBar: 0xffe9a8,
  },
  2: {
    accent: 0xd65b46,
    accentEmissive: 0x2a0600,
    hull: 0x5c5350,
    hullDark: 0x3a3230,
    canvas: 0x4a3f38,
    lightBar: 0xff8f6a,
  },
  3: {
    accent: 0x6cb9ff,
    accentEmissive: 0x001d34,
    hull: 0x526976,
    hullDark: 0x324350,
    canvas: 0x3f5260,
    lightBar: 0xa8d9ff,
  },
  4: {
    accent: 0x93cf68,
    accentEmissive: 0x102600,
    hull: 0x5f7157,
    hullDark: 0x3d4a36,
    canvas: 0x4e5a3d,
    lightBar: 0xd7f2a0,
  },
};

export type FactionId = 1 | 2 | 3 | 4;

const DEFAULT_FACTIONS: Record<FactionId, FactionPalette> = Object.fromEntries(
  Object.entries(FACTION).map(([id, palette]) => [id, { ...palette }]),
) as Record<FactionId, FactionPalette>;

const PLAYER_COLORS = {
  jade: { accent: 0x67d59b, accentEmissive: 0x063020, lightBar: 0xb6ffd4 },
  crimson: { accent: 0xed6a5c, accentEmissive: 0x340806, lightBar: 0xffb1a6 },
  azure: { accent: 0x67b8ef, accentEmissive: 0x061d38, lightBar: 0xb9e4ff },
  amber: { accent: 0xe8b854, accentEmissive: 0x382405, lightBar: 0xffe7a4 },
} as const;

/** Applies lobby colour choices before world views create their faction materials. */
export function applyMultiplayerFactionColors(colors: Partial<Record<number, keyof typeof PLAYER_COLORS>> = {}): void {
  for (const id of [1, 2, 3, 4] as FactionId[]) Object.assign(FACTION[id], DEFAULT_FACTIONS[id]);
  for (const [team, color] of Object.entries(colors)) {
    const id = Number(team) as FactionId;
    if (!FACTION[id] || !color || !PLAYER_COLORS[color]) continue;
    Object.assign(FACTION[id], PLAYER_COLORS[color]);
  }
}

export function factionId(teamId: number | undefined): FactionId {
  return teamId === 2 || teamId === 3 || teamId === 4 ? teamId : 1;
}
