export type ArmorClass = 'infantry' | 'light' | 'heavy' | 'building' | 'air';
export type WeaponKind =
  | 'rifle'
  | 'rifleGrenade'
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
  | 'microLaser'
  | 'overchargeRifle'
  | 'clusterGrenade'
  | 'railShot'
  | 'swarmRocket'
  | 'annihilatorMissile'
  | 'strategicMissile';

export type ProjectileKind = 'grenade' | 'kineticShell' | 'artilleryShell' | 'atRocket' | 'scoutMissile' | 'tankMissile' | 'siegeMissile' | 'agMissile' | 'aaMissile';

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
  microLaser: {
    kind: 'microLaser',
    label: 'Escort Micro-Laser',
    damage: 7,
    cooldown: 0.5,
    range: 96,
    splashRadius: 0,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.35, light: 0.22, heavy: 0.06, building: 0.025, air: 0 },
  },
  rifle: {
    kind: 'rifle',
    label: 'Rifle Burst',
    damage: 11,
    cooldown: 0.72,
    range: 68,
    splashRadius: 0,
    targetTypes: ['infantry', 'light', 'heavy'],
    vs: { infantry: 1, light: 0.45, heavy: 0.2, building: 0.12, air: 0 },
  },
  rifleGrenade: {
    kind: 'rifleGrenade',
    label: '40mm Under-Barrel HE',
    damage: 15,
    cooldown: 2.7,
    range: 58,
    minRange: 8,
    splashRadius: 3.1,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.18, light: 0.48, heavy: 0.2, building: 0.3, air: 0 },
    projectile: { kind: 'grenade', speed: 30, trajectory: 'arc', impactRadius: 1.1 },
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
    label: 'Top-Attack AT Missile',
    damage: 42,
    cooldown: 4.4,
    range: 132,
    minRange: 12,
    splashRadius: 2.1,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.36, light: 1.05, heavy: 1.08, building: 0.58, air: 0 },
    projectile: { kind: 'atRocket', speed: 88, trajectory: 'homing', impactRadius: 1.6, fizzleRange: 175 },
  },
  scoutMissile: {
    kind: 'scoutMissile',
    label: 'Jackal Light ATGM',
    damage: 38,
    cooldown: 4.2,
    range: 148,
    splashRadius: 1.6,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.82, light: 0.88, heavy: 0.48, building: 0.32, air: 0.28 },
    projectile: { kind: 'scoutMissile', speed: 92, trajectory: 'homing', impactRadius: 1.6, fizzleRange: 190 },
  },
  tankMissile: {
    kind: 'tankMissile',
    label: 'M-17 Guided AT Missile',
    damage: 52,
    cooldown: 5.4,
    range: 178,
    splashRadius: 2.6,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.9, light: 0.96, heavy: 0.72, building: 0.5, air: 0.42 },
    projectile: { kind: 'tankMissile', speed: 98, trajectory: 'homing', impactRadius: 2.0, fizzleRange: 225 },
  },
  siegeMissile: {
    kind: 'siegeMissile',
    label: 'Mauler Heavy Missile',
    damage: 48,
    cooldown: 1.42,
    range: 118,
    splashRadius: 3.9,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.82, light: 1.02, heavy: 1.0, building: 0.72, air: 0.58 },
    projectile: { kind: 'siegeMissile', speed: 86, trajectory: 'flat', impactRadius: 3.0 },
  },
  autocannon: {
    kind: 'autocannon',
    label: '25mm Chain Gun',
    damage: 5,
    cooldown: 0.16,
    range: 86,
    airRange: 46,
    canTargetAir: true,
    splashRadius: 0,
    targetTypes: ['infantry', 'light', 'heavy', 'air'],
    vs: { infantry: 1.08, light: 0.64, heavy: 0.08, building: 0.03, air: 0.22 },
  },
  waspAutocannon: {
    kind: 'waspAutocannon',
    label: '20mm Rotary Cannon',
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
    label: '120mm Kinetic Round',
    damage: 28,
    cooldown: 2.15,
    range: 132,
    // The collision/damage envelope represents the shell's penetrator and
    // fragmentation cone, not a giant visual blast. It also keeps normal AI
    // useful against broad building facades despite small aim scatter.
    splashRadius: 1.8,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 0.3, light: 1.02, heavy: 0.94, building: 0.46, air: 0 },
    projectile: { kind: 'kineticShell', speed: 210, trajectory: 'flat', impactRadius: 0.8 },
  },
  heavyCannon: {
    kind: 'heavyCannon',
    label: '155mm Siege Howitzer',
    damage: 58,
    cooldown: 5.1,
    range: 194,
    minRange: 26,
    splashRadius: 8.2,
    targetTypes: ['light', 'heavy', 'building'],
    vs: { infantry: 1.0, light: 0.9, heavy: 0.78, building: 0.82, air: 0 },
    projectile: { kind: 'artilleryShell', speed: 62, trajectory: 'arc', impactRadius: 3.2 },
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
    damage: 13,
    cooldown: 0.24,
    range: 112,
    splashRadius: 3,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 1.15, light: 0.9, heavy: 0.58, building: 0.34, air: 0 },
    projectile: { kind: 'atRocket', speed: 138, trajectory: 'flat', impactRadius: 1.2 },
  },
  agMissile: {
    kind: 'agMissile',
    label: 'Hammerhead Multi-Role Missile',
    damage: 44,
    cooldown: 2.8,
    range: 150,
    airRange: 142,
    canTargetAir: true,
    splashRadius: 5.2,
    targetTypes: ['light', 'heavy', 'building', 'air'],
    vs: { infantry: 0.55, light: 0.88, heavy: 0.78, building: 0.62, air: 0.68 },
    projectile: { kind: 'agMissile', speed: 104, trajectory: 'homing', impactRadius: 2.8, fizzleRange: 230 },
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
  strategicMissile: {
    kind: 'strategicMissile',
    label: 'Long-Range Strategic Missile',
    damage: 460,
    cooldown: 30,
    range: 1800,
    splashRadius: 18,
    targetTypes: ['infantry', 'light', 'heavy', 'building'],
    vs: { infantry: 0.8, light: 0.9, heavy: 0.95, building: 1, air: 0 },
    projectile: { kind: 'siegeMissile', speed: 42, trajectory: 'homing', impactRadius: 7 },
  },
};
