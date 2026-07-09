import type { StructureKind } from './phase3';

export type Personality = 'turtle' | 'rusher' | 'balanced';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface PersonalityDef {
  buildOrder: StructureKind[];
  targetRefineries: number;
  targetFactories: number;
  wantsBarracks: boolean;
  squadSize: number;
  /** tanks kept home as base defense before forming attack squads */
  homeGuard: number;
  /** seconds before the first attack squad may launch */
  attackDelay: number;
  /** concurrent attack squads — waves, not a single flood */
  maxSquads: number;
}

export interface DifficultyDef {
  /** seconds between AI decisions — its "reaction time" */
  reactionDelay: number;
  /** first attack timing modifier; Normal is exactly 1 */
  attackDelayMultiplier: number;
  /** resource handicap; Normal is exactly 1 — never map hacks, only economics */
  incomeMultiplier: number;
  /** auto-combat hit quality; Normal is exactly 1 */
  combatAccuracy: number;
  /** auto-combat reload handicap; Normal is exactly 1 */
  combatCooldownMultiplier: number;
  /** deterministic projectile aim scatter in map units */
  projectileScatter: number;
  /** ticks before a unit may acquire a fresh target after losing/finishing one */
  targetAcquireDelayTicks: number;
  /** lower values make the AI less eager to dogpile the player-possessed unit */
  possessedTargetPriority: number;
  tankCap: number;
  infantryCap: number;
  startCredits: number;
}

export const AI_PERSONALITY: Record<Personality, PersonalityDef> = {
  turtle: {
    buildOrder: ['power-plant', 'refinery', 'power-plant', 'factory'],
    targetRefineries: 3,
    targetFactories: 1,
    wantsBarracks: true,
    squadSize: 10,
    homeGuard: 6,
    attackDelay: 600,
    maxSquads: 1,
  },
  rusher: {
    buildOrder: ['power-plant', 'refinery', 'factory'],
    targetRefineries: 1,
    targetFactories: 2,
    wantsBarracks: false,
    squadSize: 4,
    homeGuard: 0,
    attackDelay: 60,
    maxSquads: 2,
  },
  balanced: {
    buildOrder: ['power-plant', 'refinery', 'factory'],
    targetRefineries: 2,
    targetFactories: 2,
    wantsBarracks: true,
    squadSize: 7,
    homeGuard: 3,
    attackDelay: 420,
    maxSquads: 1,
  },
};

export const AI_DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: {
    reactionDelay: 3.2,
    attackDelayMultiplier: 1.75,
    incomeMultiplier: 0.62,
    combatAccuracy: 0.58,
    combatCooldownMultiplier: 1.55,
    projectileScatter: 8.5,
    targetAcquireDelayTicks: 42,
    possessedTargetPriority: 0.92,
    tankCap: 8,
    infantryCap: 4,
    startCredits: 2600,
  },
  normal: {
    reactionDelay: 1.1,
    attackDelayMultiplier: 1.0,
    incomeMultiplier: 1.0,
    combatAccuracy: 0.97,
    combatCooldownMultiplier: 1.0,
    projectileScatter: 0.8,
    targetAcquireDelayTicks: 4,
    possessedTargetPriority: 0.55,
    tankCap: 22,
    infantryCap: 8,
    startCredits: 4600,
  },
  hard: {
    reactionDelay: 0.55,
    attackDelayMultiplier: 0.72,
    incomeMultiplier: 1.35,
    combatAccuracy: 1.0,
    combatCooldownMultiplier: 0.9,
    projectileScatter: 0.5,
    targetAcquireDelayTicks: 0,
    possessedTargetPriority: 0.45,
    tankCap: 34,
    infantryCap: 12,
    startCredits: 6500,
  },
};
