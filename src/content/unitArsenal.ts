import type { UnitKind } from './phase3';
import type { WeaponKind } from './phase4';

export type WeaponHudFamily = 'rifle' | 'ballistic' | 'precision' | 'seeker' | 'armor' | 'artillery' | 'aviation' | 'strike';

export interface UnitArsenal {
  primary: WeaponKind;
  secondary?: WeaponKind;
  secondarySalvoCount?: number;
  designation: string;
  fireControl: string;
  hud: WeaponHudFamily;
}

/**
 * The single source of truth for combat identity. Simulation spawners, unit
 * cards and V-mode HUDs all read this table so a balance change cannot leave
 * the UI describing an obsolete weapon.
 */
export const UNIT_ARSENALS: Record<UnitKind, UnitArsenal> = {
  infantry: {
    primary: 'rifle',
    secondary: 'rifleGrenade',
    designation: 'R-5 CARBINE TEAM',
    fireControl: 'REFLEX / 40MM AUX',
    hud: 'rifle',
  },
  grenadier: {
    primary: 'grenade',
    designation: 'G-40 GRENADIER',
    fireControl: 'BALLISTIC LADDER',
    hud: 'ballistic',
  },
  sniper: {
    primary: 'sniperRifle',
    designation: 'LRS-12 MARKSMAN',
    fireControl: 'VARIABLE OPTIC',
    hud: 'precision',
  },
  'rocket-infantry': {
    primary: 'rocketLauncher',
    secondary: 'aaMissile',
    designation: 'JAVELIN AT TEAM',
    fireControl: 'TOP / DIRECT SEEKER',
    hud: 'seeker',
  },
  'scout-tank': {
    primary: 'autocannon',
    secondary: 'scoutMissile',
    designation: 'JACKAL RECON AFV',
    fireControl: '25MM LEAD COMPUTER',
    hud: 'armor',
  },
  tank: {
    primary: 'cannon',
    secondary: 'tankMissile',
    designation: 'M-17 MAIN BATTLE TANK',
    fireControl: '120MM STABILIZED FCS',
    hud: 'armor',
  },
  'siege-tank': {
    primary: 'heavyCannon',
    secondary: 'autocannon',
    designation: 'MAULER SIEGE GUN',
    fireControl: '155MM INDIRECT FCS',
    hud: 'artillery',
  },
  wasp: {
    primary: 'waspAutocannon',
    secondary: 'aaMissile',
    designation: 'WASP ARMED SCOUT',
    fireControl: '20MM AIR LEAD SIGHT',
    hud: 'aviation',
  },
  vulture: {
    primary: 'rocketPod',
    secondary: 'autocannon',
    designation: 'VULTURE ROCKET GUNSHIP',
    fireControl: 'ROCKET IMPACT COMPUTER',
    hud: 'aviation',
  },
  hammerhead: {
    primary: 'agMissile',
    secondary: 'bomb',
    secondarySalvoCount: 4,
    designation: 'HAMMERHEAD STRIKE CRAFT',
    fireControl: 'MULTI-ROLE SEEKER / BOMB BAY',
    hud: 'strike',
  },
};

export function arsenalForUnit(kind: UnitKind): UnitArsenal {
  return UNIT_ARSENALS[kind];
}
