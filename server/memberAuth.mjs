import { createHash } from 'node:crypto';

/**
 * Membership checks for the relay.
 *
 * The relay has never authenticated anyone: any client could join a room with an
 * invented playerId. Turning that on in one step risks locking real players out of
 * multiplayer, so this rolls out in three modes, set by MEMBER_AUTH:
 *
 *   off      no checking at all — the pre-member behaviour
 *   log      verify and record the outcome, but let everyone in (default)
 *   enforce  reject connections without a valid Wix member token
 *
 * `log` is the point: it turns "did we just lock players out?" into a number you
 * read before flipping to `enforce`, and the switch is an env var, not a deploy.
 */

const MEMBER_ENDPOINT = 'https://www.wixapis.com/members/v1/members/my';
const VERIFY_TIMEOUT_MS = 6_000;
const POSITIVE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 500;

/** @param {string | undefined} raw */
export function resolveMemberAuthMode(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'off' || value === 'false' || value === 'none') return 'off';
  if (value === 'enforce' || value === 'strict' || value === 'on') return 'enforce';
  return 'log';
}

function fingerprint(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

export function createMemberVerifier(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const cache = new Map();
  const stats = { checked: 0, verified: 0, rejected: 0, errored: 0, cacheHits: 0 };

  function remember(key, value, ttl) {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { value, expiresAt: now() + ttl });
    return value;
  }

  return {
    stats: () => ({ ...stats }),
    /**
     * Resolves to `{ ok, memberId?, nickname?, reason? }`. A transport failure is
     * reported as `reason: 'unavailable'` and never as a rejection, so a Wix outage
     * cannot take multiplayer down even in enforce mode.
     */
    async verify(token) {
      if (typeof token !== 'string' || token.length < 20) return { ok: false, reason: 'missing-token' };
      const key = fingerprint(token);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        stats.cacheHits += 1;
        return cached.value;
      }
      cache.delete(key);
      stats.checked += 1;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
      try {
        const response = await fetchImpl(`${MEMBER_ENDPOINT}?fieldSet=FULL`, {
          headers: { authorization: token },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          stats.rejected += 1;
          return remember(key, { ok: false, reason: 'invalid-token' }, NEGATIVE_TTL_MS);
        }
        if (!response.ok) {
          stats.errored += 1;
          return { ok: false, reason: 'unavailable' };
        }
        const member = (await response.json())?.member;
        if (!member?.id) {
          stats.rejected += 1;
          return remember(key, { ok: false, reason: 'no-member' }, NEGATIVE_TTL_MS);
        }
        stats.verified += 1;
        return remember(
          key,
          { ok: true, memberId: String(member.id), nickname: member.profile?.nickname ?? undefined },
          POSITIVE_TTL_MS,
        );
      } catch {
        stats.errored += 1;
        return { ok: false, reason: 'unavailable' };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Decides what the relay should do with a verification result.
 * Only `enforce` can ever reject, and only for a token that Wix actively refused —
 * an unreachable Wix is treated as "let them play".
 */
export function membershipDecision(mode, result) {
  if (mode === 'off') return { allow: true, identity: undefined };
  if (result.ok) return { allow: true, identity: { memberId: result.memberId, nickname: result.nickname } };
  if (mode === 'log') return { allow: true, identity: undefined, logged: result.reason };
  if (result.reason === 'unavailable') return { allow: true, identity: undefined, logged: 'unavailable' };
  return { allow: false, identity: undefined, logged: result.reason };
}
