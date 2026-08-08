import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM module shared with the relay
import { createMemberVerifier, membershipDecision, resolveMemberAuthMode } from './memberAuth.mjs';

const SECRET = 'shared-secret';
const MEMBER_ID = 'member-1';
const ticketFor = (memberId: string, secret = SECRET) =>
  createHmac('sha256', secret).update(memberId).digest('base64url');

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

describe('membership ticket verifier', () => {
  it('accepts the ticket the Worker minted for that member', () => {
    const verifier = createMemberVerifier({ secret: SECRET });
    expect(verifier.verify(MEMBER_ID, ticketFor(MEMBER_ID))).toEqual({ ok: true, memberId: MEMBER_ID });
    expect(verifier.stats()).toMatchObject({ checked: 1, verified: 1 });
  });

  it('refuses a member id the player simply claimed, with no ticket to back it', () => {
    const verifier = createMemberVerifier({ secret: SECRET });
    expect(verifier.verify(MEMBER_ID, undefined)).toEqual({ ok: false, reason: 'missing-ticket' });
  });

  it('refuses a valid ticket replayed against a different member', () => {
    const verifier = createMemberVerifier({ secret: SECRET });
    expect(verifier.verify('member-2', ticketFor(MEMBER_ID))).toEqual({ ok: false, reason: 'invalid-ticket' });
  });

  it('refuses a ticket signed with the wrong secret', () => {
    const verifier = createMemberVerifier({ secret: SECRET });
    expect(verifier.verify(MEMBER_ID, ticketFor(MEMBER_ID, 'some-other-secret'))).toEqual({
      ok: false,
      reason: 'invalid-ticket',
    });
  });

  it('refuses a truncated ticket rather than comparing a prefix', () => {
    const verifier = createMemberVerifier({ secret: SECRET });
    expect(verifier.verify(MEMBER_ID, ticketFor(MEMBER_ID).slice(0, 10))).toEqual({
      ok: false,
      reason: 'invalid-ticket',
    });
  });

  it('reports unavailable when no secret is configured, so a missing env var cannot lock players out', () => {
    const verifier = createMemberVerifier({});
    expect(verifier.verify(MEMBER_ID, ticketFor(MEMBER_ID))).toEqual({ ok: false, reason: 'unavailable' });
    expect(verifier.stats()).toMatchObject({ unconfigured: 1, checked: 0 });
  });

  it('makes no network call, so a Wix outage cannot reach the join path', () => {
    // There is nothing to stub: verification is an HMAC over the member id.
    const verifier = createMemberVerifier({ secret: SECRET });
    for (let index = 0; index < 1000; index += 1) verifier.verify(MEMBER_ID, ticketFor(MEMBER_ID));
    expect(verifier.stats()).toMatchObject({ verified: 1000, rejected: 0 });
  });
});

describe('membership decision', () => {
  const invalid = { ok: false, reason: 'invalid-ticket' } as const;
  const verified = { ok: true, memberId: MEMBER_ID } as const;

  it('lets everyone through when the check is off', () => {
    expect(membershipDecision('off', invalid)).toMatchObject({ allow: true, identity: undefined });
  });

  it('never rejects in log mode, but records why', () => {
    expect(membershipDecision('log', invalid)).toMatchObject({ allow: true, logged: 'invalid-ticket' });
  });

  it('rejects an invalid ticket only in enforce mode', () => {
    expect(membershipDecision('enforce', invalid)).toMatchObject({ allow: false });
  });

  it('keeps multiplayer up when the relay cannot check at all, even in enforce mode', () => {
    expect(membershipDecision('enforce', { ok: false, reason: 'unavailable' })).toMatchObject({
      allow: true,
      logged: 'unavailable',
    });
  });

  it('passes the verified identity through in every mode that checks', () => {
    for (const mode of ['log', 'enforce'] as const) {
      expect(membershipDecision(mode, verified)).toMatchObject({
        allow: true,
        identity: { memberId: MEMBER_ID },
      });
    }
  });
});
