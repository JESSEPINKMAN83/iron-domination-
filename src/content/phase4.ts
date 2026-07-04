export type ArmorClass = 'infantry' | 'light' | 'heavy' | 'building';
export type WeaponKind = 'rifle' | 'cannon' | 'bomb';

export interface WeaponDef {
  kind: WeaponKind;
  label: string;
  damage: number;
  cooldown: number;
  range: number;
  splashRadius: number;
  targetTypes: ArmorClass[];
  vs: Record<ArmorClass, number>;
}

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  rifle: {
    kind: 'rifle',
    label: 'Rifle Burst',
    damage: 11,
    cooldown: 0.72,
    range: 42,
    splashRadius: 0,
    targetTypes: ['infantry', 'light', 'heavy'],
    vs: { infantry: 1, light: 0.45, heavy: 0.2, building: 0.12 },
  },
  cannon: {
    kind: 'cannon',
    label: 'Light Cannon',
    damage: 12,
    cooldown: 0.38,
    range: 78,
    splashRadius: 1.5,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.9, light: 0.75, heavy: 0.48, building: 0.28 },
  },
  bomb: {
    kind: 'bomb',
    label: 'Siege Bomb',
    damage: 72,
    cooldown: 3.8,
    range: 152,
    splashRadius: 14,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.35, light: 1.15, heavy: 1, building: 0.9 },
  },
};
