import { armyName } from '../content/nations';
import type { Entity } from '../sim/components';
import { CAPTURE_TICKS, OBJECTIVE_INFO } from '../sim/objectives';

/** Ownership is public; a hidden capture attempt must not expose enemy presence. */
export function objectiveStatus(objective: NonNullable<Entity['objective']>, known: boolean, localTeam: number) {
  const o = objective;
  const owner = o.ownerTeam === undefined ? 'Neutral' : `${armyName(o.ownerTeam)}${o.ownerTeam === localTeam ? ' (you)' : ''}`;
  const capturing = known && !o.contested ? o.capturingTeam : undefined;
  const percent = Math.floor(o.captureTicks / CAPTURE_TICKS * 100);
  const state = known && o.contested ? `${owner} · Contested` : capturing !== undefined ? `${armyName(capturing)} capturing ${percent}%` : owner;
  const detail = known && o.contested ? 'Opposing ground armies are inside the ring. Clear the enemy to resume capture.' : capturing !== undefined ? `${armyName(capturing)} is capturing: ${percent}%. Keep ground units inside the ring.` : 'Stand armed ground units beside the structure, inside the 25 m ring, for 8 seconds.';
  return {
    label: `${o.kind.toUpperCase()} · ${state}`,
    description: `${OBJECTIVE_INFO[o.kind].label}. Owner: ${owner}. ${detail} ${OBJECTIVE_INFO[o.kind].benefit}. Right-clicking only issues a movement order; troops must reach and hold the site.`,
    flagTeam: capturing ?? o.ownerTeam,
  };
}
