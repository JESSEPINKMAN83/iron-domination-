export type ArmorClass = 'infantry' | 'light' | 'heavy' | 'building';
export type WeaponKind = 'rifle' | 'cannon';

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
    label: '90mm Cannon',
    damage: 28,
    cooldown: 1.45,
    range: 86,
    splashRadius: 4.5,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 1.25, light: 0.85, heavy: 1, building: 0.62 },
  },
};
