export type CombatMode = 'assisted' | 'manual';

export const COMBAT_MODES: CombatMode[] = ['assisted', 'manual'];

export const COMBAT_MODE_DESCRIPTIONS: Record<CombatMode, string> = {
  assisted: 'Units auto-acquire enemies and nearby defenders respond when the base is hit.',
  manual: 'No auto-attack or auto-defense. Players must actively order attacks and protection.',
};
