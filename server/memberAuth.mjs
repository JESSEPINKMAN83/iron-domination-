import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Membership checks for the relay.
 *
 * The relay has never authenticated anyone: any client could join a room with an
 * invented playerId. Turning that on in one step risks locking real players out of
 * multiplayer, so this rolls out in three modes, set by MEMBER_AUTH:
 *
 *   off      no checking at all — the pre-member behaviour
 *   log      verify and record the outcome, but let everyone in (default)
 *   enforce  reject connections without a valid membership ticket
 *
 * `log` is the point: it turns "did we just lock players out?" into a number you
 * read before flipping to `enforce`, and the switch is an env var, not a deploy.
 *
 * A ticket is `HMAC_SHA256(memberId, IRON_DOMINION_INGEST_SECRET)`, minted by the
 * Worker when it creates the member. Verifying it is local arithmetic, so there is
 * no Wix call in the join path at all: no latency, no cache to reason about, no
 * outage that can take multiplayer down, and no member token in the browser. A
 * client can claim any memberId it likes; without the secret it cannot sign one.
 */

/** @param {string | undefined} raw */
export function resolveMemberAuthMode(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'off' || value === 'false' || value === 'none') return 'off';
  if (value === 'enforce' || value === 'strict' || value === 'on') return 'enforce';
  return 'log';
}

function sign(secret, memberId) {
  return createHmac('sha256', secret).update(memberId).digest('base64url');
}

function matches(expected, provided) {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createMemberVerifier(options = {}) {
  const secret = String(options.secret ?? '');
  const stats = { checked: 0, verified: 0, rejected: 0, unconfigured: 0 };

  return {
    stats: () => ({ ...stats }),
    /**
     * Returns `{ ok, memberId?, reason? }`. A relay with no secret configured reports
     * `unavailable`, which never rejects — the same posture the token verifier took
     * when Wix was unreachable, so a missing env var degrades to today's behaviour
     * instead of locking everyone out.
     */
    verify(memberId, ticket) {
      if (!secret) {
        stats.unconfigured += 1;
        return { ok: false, reason: 'unavailable' };
      }
      if (typeof memberId !== 'string' || !memberId || typeof ticket !== 'string' || !ticket) {
        return { ok: false, reason: 'missing-ticket' };
      }
      stats.checked += 1;
      if (!matches(sign(secret, memberId), ticket)) {
        stats.rejected += 1;
        return { ok: false, reason: 'invalid-ticket' };
      }
      stats.verified += 1;
      return { ok: true, memberId };
    },
  };
}

/**
 * Decides what the relay should do with a verification result.
 * Only `enforce` can ever reject, and only for a ticket that failed its signature —
 * a relay that cannot check at all is treated as "let them play".
 */
export function membershipDecision(mode, result) {
  if (mode === 'off') return { allow: true, identity: undefined };
  if (result.ok) return { allow: true, identity: { memberId: result.memberId } };
  if (mode === 'log') return { allow: true, identity: undefined, logged: result.reason };
  if (result.reason === 'unavailable') return { allow: true, identity: undefined, logged: 'unavailable' };
  return { allow: false, identity: undefined, logged: result.reason };
}
