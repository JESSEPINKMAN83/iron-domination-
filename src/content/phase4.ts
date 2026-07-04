export type ArmorClass = 'infantry' | 'light' | 'heavy' | 'building';
export type WeaponKind = 'rifle' | 'grenade' | 'rocketLauncher' | 'autocannon' | 'cannon' | 'heavyCannon' | 'bomb' | 'rocketPod' | 'agMissile' | 'aaMissile';

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
  grenade: {
    kind: 'grenade',
    label: 'Grenade Volley',
    damage: 18,
    cooldown: 1.25,
    range: 48,
    splashRadius: 3.6,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.25, light: 0.62, heavy: 0.32, building: 0.22 },
  },
  rocketLauncher: {
    kind: 'rocketLauncher',
    label: 'Rocket Launcher',
    damage: 25,
    cooldown: 1.7,
    range: 72,
    splashRadius: 2.4,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.45, light: 0.95, heavy: 0.78, building: 0.52 },
  },
  autocannon: {
    kind: 'autocannon',
    label: 'Autocannon',
    damage: 8,
    cooldown: 0.16,
    range: 62,
    splashRadius: 0,
    targetTypes: ['infantry', 'light', 'heavy'],
    vs: { infantry: 1.05, light: 0.72, heavy: 0.26, building: 0.08 },
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
  heavyCannon: {
    kind: 'heavyCannon',
    label: 'Heavy Cannon',
    damage: 24,
    cooldown: 1.65,
    range: 104,
    splashRadius: 2.2,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.75, light: 0.82, heavy: 0.88, building: 0.48 },
  },
  bomb: {
    kind: 'bomb',
    label: 'Siege Bomb',
    damage: 26,
    cooldown: 4.1,
    range: 152,
    splashRadius: 5.6,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.95, light: 0.72, heavy: 0.58, building: 0.3 },
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
  aaMissile: {
    kind: 'aaMissile',
    label: 'AA Missile',
    damage: 42,
    cooldown: 2.8,
    range: 145,
    splashRadius: 5,
    targetTypes: ['light'],
    vs: { infantry: 0.2, light: 1.1, heavy: 0.25, building: 0.08 },
  },
};
