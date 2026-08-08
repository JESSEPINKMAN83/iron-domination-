import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - plain ESM module shared with the relay
import { createMemberVerifier, membershipDecision, resolveMemberAuthMode } from './memberAuth.mjs';

const TOKEN = 'member-access-token-that-is-long-enough';

function jsonResponse(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(payload) };
}

describe('relay membership mode', () => {
  it('defaults to log so a rollout observes before it rejects', () => {
    expect(resolveMemberAuthMode(undefined)).toBe('log');
    expect(resolveMemberAuthMode('')).toBe('log');
    expect(resolveMemberAuthMode('nonsense')).toBe('log');
  });

  it('understands the off and enforce switches', () => {
    expect(resolveMemberAuthMode('off')).toBe('off');
    expect(resolveMemberAuthMode('NONE')).toBe('off');
    expect(resolveMemberAuthMode('enforce')).toBe('enforce');
    expect(resolveMemberAuthMode(' Strict ')).toBe('enforce');
  });
});

describe('member verifier', () => {
  it('verifies a token once and serves the rest from cache', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ member: { id: 'member-1', profile: { nickname: 'Iron Fox' } } }),
    );
    const verifier = createMemberVerifier({ fetch: fetchImpl });

    await expect(verifier.verify(TOKEN)).resolves.toEqual({ ok: true, memberId: 'member-1', nickname: 'Iron Fox' });
    await expect(verifier.verify(TOKEN)).resolves.toMatchObject({ ok: true, memberId: 'member-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verifier.stats()).toMatchObject({ checked: 1, verified: 1, cacheHits: 1 });
  });

  it('sends the token as the authorization header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ member: { id: 'm' } }));
    await createMemberVerifier({ fetch: fetchImpl }).verify(TOKEN);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ authorization: TOKEN });
  });

  it('rejects an unauthorized token and caches that briefly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const verifier = createMemberVerifier({ fetch: fetchImpl });
    await expect(verifier.verify(TOKEN)).resolves.toEqual({ ok: false, reason: 'invalid-token' });
    await verifier.verify(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-checks a negative result once its short ttl lapses', async () => {
    let clock = 0;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const verifier = createMemberVerifier({ fetch: fetchImpl, now: () => clock });
    await verifier.verify(TOKEN);
    clock += 31_000;
    await verifier.verify(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats a missing token as a rejection without calling Wix', async () => {
    const fetchImpl = vi.fn();
    await expect(createMemberVerifier({ fetch: fetchImpl }).verify(undefined)).resolves.toEqual({
      ok: false,
      reason: 'missing-token',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a transport failure as unavailable rather than invalid, and does not cache it', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const verifier = createMemberVerifier({ fetch: fetchImpl });
    await expect(verifier.verify(TOKEN)).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await verifier.verify(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('membership decision', () => {
  const invalid = { ok: false, reason: 'invalid-token' } as const;
  const verified = { ok: true, memberId: 'member-1', nickname: 'Iron Fox' } as const;

  it('lets everyone through when the check is off', () => {
    expect(membershipDecision('off', invalid)).toMatchObject({ allow: true, identity: undefined });
  });

  it('never rejects in log mode, but records why', () => {
    expect(membershipDecision('log', invalid)).toMatchObject({ allow: true, logged: 'invalid-token' });
  });

  it('rejects an invalid token only in enforce mode', () => {
    expect(membershipDecision('enforce', invalid)).toMatchObject({ allow: false });
  });

  it('keeps multiplayer up when Wix is unreachable, even in enforce mode', () => {
    expect(membershipDecision('enforce', { ok: false, reason: 'unavailable' })).toMatchObject({
      allow: true,
      logged: 'unavailable',
    });
  });

  it('passes the verified identity through in every mode that checks', () => {
    for (const mode of ['log', 'enforce'] as const) {
      expect(membershipDecision(mode, verified)).toMatchObject({
        allow: true,
        identity: { memberId: 'member-1', nickname: 'Iron Fox' },
      });
    }
  });
});
