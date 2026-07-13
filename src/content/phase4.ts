export type ArmorClass = 'infantry' | 'light' | 'heavy' | 'building' | 'air';
export type WeaponKind =
  | 'rifle'
  | 'sniperRifle'
  | 'grenade'
  | 'rocketLauncher'
  | 'scoutMissile'
  | 'tankMissile'
  | 'siegeMissile'
  | 'autocannon'
  | 'waspAutocannon'
  | 'cannon'
  | 'heavyCannon'
  | 'tankBomb'
  | 'bomb'
  | 'rocketPod'
  | 'agMissile'
  | 'aaMissile'
  | 'overchargeRifle'
  | 'clusterGrenade'
  | 'railShot'
  | 'swarmRocket'
  | 'annihilatorMissile';

export type ProjectileKind = 'grenade' | 'atRocket' | 'scoutMissile' | 'tankMissile' | 'siegeMissile' | 'agMissile' | 'aaMissile';

export interface WeaponDef {
  kind: WeaponKind;
  label: string;
  damage: number;
  cooldown: number;
  range: number;
  minRange?: number;
  airRange?: number;
  canTargetAir?: boolean;
  splashRadius: number;
  targetTypes: ArmorClass[];
  vs: Record<ArmorClass, number>;
  projectile?: {
    kind: ProjectileKind;
    speed: number;
    trajectory: 'arc' | 'flat' | 'drop' | 'homing';
    impactRadius?: number;
    fizzleRange?: number;
  };
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
    vs: { infantry: 1, light: 0.45, heavy: 0.2, building: 0.12, air: 0 },
  },
  sniperRifle: {
    kind: 'sniperRifle',
    label: 'Scoped Rifle',
    damage: 64,
    cooldown: 1.35,
    range: 320,
    splashRadius: 0,
    targetTypes: ['infantry'],
    vs: { infantry: 1.35, light: 0.12, heavy: 0.03, building: 0.02, air: 0 },
  },
  grenade: {
    kind: 'grenade',
    label: 'Grenade Volley',
    damage: 18,
    cooldown: 1.25,
    range: 48,
    minRange: 10,
    splashRadius: 3.6,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.25, light: 0.62, heavy: 0.32, building: 0.46, air: 0 },
    projectile: { kind: 'grenade', speed: 26, trajectory: 'arc' },
  },
  rocketLauncher: {
    kind: 'rocketLauncher',
    label: 'Rocket Launcher',
    damage: 25,
    cooldown: 1.7,
    range: 72,
    splashRadius: 2.4,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.45, light: 0.95, heavy: 0.78, building: 0.52, air: 0 },
    projectile: { kind: 'atRocket', speed: 70, trajectory: 'flat', impactRadius: 1.4 },
  },
  scoutMissile: {
    kind: 'scoutMissile',
    label: 'Jackal Direct Missile',
    damage: 16,
    cooldown: 0.62,
    range: 72,
    splashRadius: 1.6,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.82, light: 0.88, heavy: 0.48, building: 0.32, air: 0 },
    projectile: { kind: 'scoutMissile', speed: 104, trajectory: 'flat', impactRadius: 1.5 },
  },
  tankMissile: {
    kind: 'tankMissile',
    label: 'M-17 Direct Missile',
    damage: 28,
    cooldown: 0.9,
    range: 92,
    splashRadius: 2.6,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.9, light: 0.96, heavy: 0.72, building: 0.5, air: 0 },
    projectile: { kind: 'tankMissile', speed: 96, trajectory: 'flat', impactRadius: 2.1 },
  },
  siegeMissile: {
    kind: 'siegeMissile',
    label: 'Mauler Heavy Missile',
    damage: 48,
    cooldown: 1.42,
    range: 118,
    splashRadius: 3.9,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.82, light: 1.02, heavy: 1.0, building: 0.72, air: 0 },
    projectile: { kind: 'siegeMissile', speed: 86, trajectory: 'flat', impactRadius: 3.0 },
  },
  autocannon: {
    kind: 'autocannon',
    label: 'Autocannon',
    damage: 8,
    cooldown: 0.16,
    range: 62,
    airRange: 46,
    canTargetAir: true,
    splashRadius: 0,
    targetTypes: ['infantry', 'light', 'heavy', 'air'],
    vs: { infantry: 1.05, light: 0.72, heavy: 0.26, building: 0.08, air: 0.28 },
  },
  waspAutocannon: {
    kind: 'waspAutocannon',
    label: 'Autocannon',
    damage: 8,
    cooldown: 0.16,
    range: 72,
    airRange: 88,
    canTargetAir: true,
    splashRadius: 0,
    targetTypes: ['infantry', 'light', 'heavy', 'air'],
    vs: { infantry: 1.0, light: 0.68, heavy: 0.22, building: 0.06, air: 0.9 },
  },
  cannon: {
    kind: 'cannon',
    label: 'Light Cannon',
    damage: 12,
    cooldown: 0.38,
    range: 78,
    splashRadius: 1.5,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.9, light: 0.75, heavy: 0.48, building: 0.28, air: 0 },
  },
  heavyCannon: {
    kind: 'heavyCannon',
    label: 'Heavy Cannon',
    damage: 24,
    cooldown: 1.65,
    range: 104,
    minRange: 26,
    splashRadius: 2.2,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.75, light: 0.82, heavy: 0.88, building: 0.48, air: 0 },
  },
  tankBomb: {
    kind: 'tankBomb',
    label: 'Heavy Arc Missile',
    damage: 42,
    cooldown: 5.2,
    range: 176,
    splashRadius: 7.5,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.95, light: 0.9, heavy: 0.82, building: 0.55, air: 0 },
  },
  bomb: {
    kind: 'bomb',
    label: 'Siege Bomb',
    damage: 26,
    cooldown: 4.1,
    range: 152,
    splashRadius: 5.6,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.95, light: 0.72, heavy: 0.58, building: 0.3, air: 0 },
  },
  rocketPod: {
    kind: 'rocketPod',
    label: 'Rocket Pods',
    damage: 16,
    cooldown: 0.22,
    range: 112,
    splashRadius: 3,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.15, light: 0.9, heavy: 0.58, building: 0.34, air: 0 },
  },
  agMissile: {
    kind: 'agMissile',
    label: 'AG Missile',
    damage: 44,
    cooldown: 2.8,
    range: 150,
    splashRadius: 5.2,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.55, light: 0.88, heavy: 0.78, building: 0.62, air: 0 },
    projectile: { kind: 'agMissile', speed: 92, trajectory: 'drop', impactRadius: 2.8 },
  },
  aaMissile: {
    kind: 'aaMissile',
    label: 'AA Missile',
    damage: 42,
    cooldown: 2.8,
    range: 145,
    airRange: 145,
    canTargetAir: true,
    splashRadius: 4.2,
    targetTypes: ['air'],
    vs: { infantry: 0, light: 0, heavy: 0, building: 0, air: 1.0 },
    projectile: { kind: 'aaMissile', speed: 110, trajectory: 'homing', impactRadius: 2.5, fizzleRange: 160 },
  },
  overchargeRifle: {
    kind: 'overchargeRifle',
    label: 'Tesla Dart',
    damage: 46,
    cooldown: 6.5,
    range: 240,
    splashRadius: 1.8,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.9, light: 1.05, heavy: 0.7, building: 0.3, air: 0 },
  },
  clusterGrenade: {
    kind: 'clusterGrenade',
    label: 'Cluster Satchel',
    damage: 48,
    cooldown: 8.5,
    range: 180,
    minRange: 8,
    splashRadius: 7.2,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.35, light: 0.9, heavy: 0.45, building: 0.55, air: 0 },
    projectile: { kind: 'grenade', speed: 38, trajectory: 'arc', impactRadius: 3.4 },
  },
  railShot: {
    kind: 'railShot',
    label: 'Rail Lance',
    damage: 142,
    cooldown: 10,
    range: 520,
    splashRadius: 0,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.2, light: 1.0, heavy: 0.82, building: 0.38, air: 0 },
  },
  swarmRocket: {
    kind: 'swarmRocket',
    label: 'Hunter Missile',
    damage: 68,
    cooldown: 9,
    range: 360,
    splashRadius: 5.4,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.8, light: 1.1, heavy: 0.82, building: 0.5, air: 0 },
    projectile: { kind: 'agMissile', speed: 118, trajectory: 'flat', impactRadius: 3.2 },
  },
  annihilatorMissile: {
    kind: 'annihilatorMissile',
    label: 'Tactical Warhead',
    damage: 116,
    cooldown: 14,
    range: 420,
    splashRadius: 9.5,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.85, light: 1.15, heavy: 1.05, building: 0.82, air: 0 },
    projectile: { kind: 'siegeMissile', speed: 104, trajectory: 'flat', impactRadius: 4.8 },
  },
};
