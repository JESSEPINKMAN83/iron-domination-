import { cachedMemberProfile } from './session';

/**
 * Per-member aggregates for multiplayer matches.
 *
 * Deliberately aggregates only — counters and timestamps, never a per-match log tied
 * to a person. That answers "who comes back and who wins" without turning the game
 * into a record of what an identified player did on a given evening, keeping the
 * privacy posture close to the anonymous telemetry alongside it.
 *
 * Single-player is never reported: an account is a multiplayer requirement, and
 * solo players stay entirely anonymous.
 */
export interface PlayerStatUpdate {
  memberId: string;
  nickname?: string;
  result: 'victory' | 'defeat';
  playMinutes: number;
  aceShare?: number;
}

export interface MatchStatInput {
  multiplayer: boolean;
  status: 'ongoing' | 'victory' | 'defeat';
  elapsedSeconds: number;
  aceShare?: number;
}

/**
 * Returns the update to send, or undefined when this match should not be recorded:
 * single player, an unfinished match, or a player without an account.
 */
export function playerStatUpdate(match: MatchStatInput): PlayerStatUpdate | undefined {
  if (!match.multiplayer) return undefined;
  if (match.status !== 'victory' && match.status !== 'defeat') return undefined;
  const member = cachedMemberProfile();
  if (!member?.id) return undefined;
  const aceShare = Number.isFinite(match.aceShare) ? Math.max(0, Math.min(1, Number(match.aceShare))) : undefined;
  return {
    memberId: member.id,
    nickname: member.nickname,
    result: match.status,
    playMinutes: Math.max(0, Math.round((Number(match.elapsedSeconds) || 0) / 6) / 10),
    ...(aceShare === undefined ? {} : { aceShare }),
  };
}
