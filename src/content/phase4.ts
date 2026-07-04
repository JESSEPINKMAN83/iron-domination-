export type ArmorClass = 'infantry' | 'light' | 'heavy' | 'building';
export type WeaponKind = 'rifle' | 'cannon' | 'bomb' | 'rocketPod' | 'agMissile';

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
    damage: 34,
    cooldown: 3.8,
    range: 152,
    splashRadius: 7.5,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.1, light: 0.85, heavy: 0.72, building: 0.45 },
  },
  rocketPod: {
    kind: 'rocketPod',
    label: 'Rocket Pods',
    damage: 16,
    cooldown: 0.22,
    range: 112,
    splashRadius: 3,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.15, light: 0.9, heavy: 0.58, building: 0.34 },
  },
  agMissile: {
    kind: 'agMissile',
    label: 'AG Missile',
    damage: 44,
    cooldown: 2.8,
    range: 150,
    splashRadius: 6,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.75, light: 1.0, heavy: 0.9, building: 0.72 },
  },
};
