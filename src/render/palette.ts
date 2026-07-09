export const FACTION = {
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
} as const;

export type FactionId = keyof typeof FACTION;

export function factionId(teamId: number | undefined): FactionId {
  return teamId === 2 || teamId === 3 || teamId === 4 ? teamId : 1;
}
