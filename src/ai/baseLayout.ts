import type { StructureKind } from '../content/phase3';
import type { Difficulty, Personality } from '../content/phase6';

export function baseLayoutPreference(kind: StructureKind, style: Personality, difficulty: Difficulty): { angle: number; radius: number; gap: number } {
 const gap = difficulty === 'extra-hard' ? 9 : difficulty === 'hard' ? 7 : difficulty === 'normal' ? 5 : 3;
 const defense = ['guard-tower','aa-tower','skylance-ciws','missile-defense'].includes(kind);
 const angle = kind === 'power-plant' ? Math.PI * 0.82 : kind === 'intelligence-center' || kind === 'strategic-silo' ? Math.PI
   : defense ? 0 : -Math.PI * 0.5;
 const radius = defense ? style === 'turtle' ? 66 : 56 : kind === 'power-plant' ? 48 : style === 'rusher' ? 40 : 52;
 return { angle, radius, gap };
}
