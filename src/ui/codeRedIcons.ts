import { nationForTeam } from '../content/nations';

/** Static portraits cover the complete roster; render generation is dev-only. */
export const CODE_RED_ICON_KINDS = [
  'command-yard', 'power-plant', 'refinery', 'barracks', 'factory', 'helipad',
  'intelligence-center', 'strategic-silo', 'wall', 'guard-tower', 'aa-tower',
  'missile-defense', 'skylance-ciws', 'infantry', 'sniper', 'grenadier',
  'rocket-infantry', 'scout-tank', 'tank', 'siege-tank', 'harvester',
  'wasp', 'vulture', 'hammerhead',
] as const;
export type CodeRedIconKind = typeof CODE_RED_ICON_KINDS[number];
const kinds = new Set<string>(CODE_RED_ICON_KINDS);

export function codeRedIconPath(kind: string, team?: number): string {
  if (kind === 'artillery') return codeRedIconPath('siege-tank',team);
  if (!kinds.has(kind)) return `/assets/ui/command-icons/${kind}.png`;
  const nation = nationForTeam(team);
  // HQ flags belong to the actual nation, including allies and proxies.
  if (kind === 'command-yard') return `/assets/ui/code-red/${nation?.id ?? 'israel'}-hq.webp`;
  const side = nation?.doctrine === 'missile-command' ? 'iran' : 'israel';
  return `/assets/ui/code-red/${side}-${kind}.webp`;
}
