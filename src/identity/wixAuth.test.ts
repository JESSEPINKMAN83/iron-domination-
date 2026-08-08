import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthorizeUrl,
  createPkceChallenge,
  exchangeCodeForTokens,
  fetchCurrentMember,
  loginMember,
  registerMember,
  renewTokens,
  verifyEmailCode,
  visitorTokens,
  WixAuthError,
} from './wixAuth';

interface StubCall {
  url: string;
  init: RequestInit;
  body: any;
}

function stubFetch(responses: Array<{ ok?: boolean; status?: number; payload: unknown }>): StubCall[] {
  const calls: StubCall[] = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Promise.resolve({
      ok: next.ok ?? true,
      status: next.status ?? 200,
      text: () => Promise.resolve(JSON.stringify(next.payload)),
      json: () => Promise.resolve(next.payload),
    } as unknown as Response);
  });
  return calls;
}

const TOKEN_PAYLOAD = { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 14_400 };

afterEach(() => vi.unstubAllGlobals());

describe('wix headless auth transport', () => {
  it('requests anonymous visitor tokens with only a client id', async () => {
    const calls = stubFetch([{ payload: TOKEN_PAYLOAD }]);
    const tokens = await visitorTokens('client-abc');

    expect(calls[0]!.url).toBe('https://www.wixapis.com/oauth2/token');
    expect(calls[0]!.body).toEqual({ clientId: 'client-abc', grantType: 'anonymous' });
    expect(tokens.accessToken).toBe('access-1');
    expect(tokens.refreshToken).toBe('refresh-1');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('renews with the snake_case refresh_token key the token endpoint expects', async () => {
    const calls = stubFetch([{ payload: TOKEN_PAYLOAD }]);
    await renewTokens('refresh-0');
    expect(calls[0]!.body).toEqual({ refresh_token: 'refresh-0', grantType: 'refresh_token' });
  });

  it('registers with the visitor token in the authorization header and an optional profile', async () => {
    const calls = stubFetch([{ payload: { state: 'SUCCESS', sessionToken: 'session-1' } }]);
    const outcome = await registerMember('visitor-token', {
      email: 'commander@example.com',
      password: 'secret',
      nickname: 'Iron Fox',
      firstName: 'Iron',
    });

    expect(calls[0]!.url).toBe('https://www.wixapis.com/_api/iam/authentication/v2/register');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('visitor-token');
    expect(calls[0]!.body).toEqual({
      loginId: { email: 'commander@example.com' },
      password: 'secret',
      profile: { firstName: 'Iron', nickname: 'Iron Fox' },
    });
    expect(outcome).toEqual({ status: 'success', sessionToken: 'session-1' });
  });

  it('omits the profile entirely when nothing was collected', async () => {
    const calls = stubFetch([{ payload: { state: 'SUCCESS', sessionToken: 's' } }]);
    await registerMember('visitor-token', { email: 'a@b.co', password: 'p' });
    expect(calls[0]!.body).not.toHaveProperty('profile');
  });

  it('maps every documented authentication state', async () => {
    stubFetch([{ payload: { state: 'REQUIRE_EMAIL_VERIFICATION', stateToken: 'state-1' } }]);
    expect(await loginMember('v', { email: 'a@b.co', password: 'p' })).toEqual({
      status: 'verify-email',
      stateToken: 'state-1',
    });

    stubFetch([{ payload: { state: 'REQUIRE_OWNER_APPROVAL' } }]);
    expect(await loginMember('v', { email: 'a@b.co', password: 'p' })).toEqual({ status: 'owner-approval' });

    stubFetch([{ payload: { state: 'SOMETHING_NEW' } }]);
    expect(await loginMember('v', { email: 'a@b.co', password: 'p' })).toMatchObject({ status: 'error' });
  });

  it('verifies an email code against the state token', async () => {
    const calls = stubFetch([{ payload: { state: 'SUCCESS', sessionToken: 'session-2' } }]);
    const outcome = await verifyEmailCode('v', { code: '123456', stateToken: 'state-1' });
    expect(calls[0]!.url).toBe('https://www.wixapis.com/_api/iam/verification/v1/auth/verify');
    expect(calls[0]!.body).toEqual({ code: '123456', stateToken: 'state-1' });
    expect(outcome).toEqual({ status: 'success', sessionToken: 'session-2' });
  });

  it('builds a PKCE authorize request that avoids the iframe flow', async () => {
    const calls = stubFetch([{ payload: { redirectSession: { fullUrl: 'https://wix/authorize' } } }]);
    const pkce = await createPkceChallenge();
    const url = await createAuthorizeUrl('visitor-token', {
      clientId: 'client-abc',
      sessionToken: 'session-1',
      redirectUri: 'https://game.example',
      pkce,
    });

    expect(url).toBe('https://wix/authorize');
    const request = calls[0]!.body.auth.authRequest;
    expect(request).toMatchObject({
      clientId: 'client-abc',
      codeChallengeMethod: 'S256',
      responseMode: 'query',
      responseType: 'code',
      scope: 'offline_access',
      sessionToken: 'session-1',
      redirectUri: 'https://game.example',
    });
    expect(request.responseMode).not.toBe('web_message');
    expect(request.codeChallenge).toBe(pkce.challenge);
    expect(request.state).toBe(pkce.state);
  });

  it('exchanges the authorization code together with the verifier and redirect uri', async () => {
    const calls = stubFetch([{ payload: TOKEN_PAYLOAD }]);
    await exchangeCodeForTokens({
      clientId: 'client-abc',
      code: 'auth-code',
      codeVerifier: 'verifier',
      redirectUri: 'https://game.example',
    });
    expect(calls[0]!.body).toEqual({
      clientId: 'client-abc',
      grantType: 'authorization_code',
      code: 'auth-code',
      codeVerifier: 'verifier',
      redirectUri: 'https://game.example',
    });
  });

  it('produces a PKCE challenge that is a url-safe sha-256 digest of the verifier', async () => {
    const pkce = await createPkceChallenge();
    expect(pkce.verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(pkce.challenge).not.toMatch(/[+/=]/);

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pkce.verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(pkce.challenge).toBe(expected);
  });

  it('gives every challenge a distinct verifier and state', async () => {
    const [first, second] = await Promise.all([createPkceChallenge(), createPkceChallenge()]);
    expect(first!.verifier).not.toBe(second!.verifier);
    expect(first!.state).not.toBe(second!.state);
  });

  it('reads the member profile fields the game displays', async () => {
    stubFetch([
      {
        payload: {
          member: {
            id: 'member-1',
            loginEmail: 'commander@example.com',
            loginEmailVerified: true,
            status: 'APPROVED',
            profile: { nickname: 'Iron Fox' },
            contact: { firstName: 'Iron' },
          },
        },
      },
    ]);
    await expect(fetchCurrentMember('member-token')).resolves.toEqual({
      id: 'member-1',
      loginEmail: 'commander@example.com',
      emailVerified: true,
      nickname: 'Iron Fox',
      firstName: 'Iron',
      status: 'APPROVED',
    });
  });

  it('treats an unauthorized member lookup as simply not signed in', async () => {
    stubFetch([{ ok: false, status: 401, payload: {} }]);
    await expect(fetchCurrentMember('stale-token')).resolves.toBeUndefined();
  });

  it('surfaces a typed error when the auth endpoint rejects the request', async () => {
    stubFetch([{ ok: false, status: 400, payload: { message: 'Password is too short', error: 'invalid_password' } }]);
    await expect(registerMember('v', { email: 'a@b.co', password: 'x' })).rejects.toBeInstanceOf(WixAuthError);
  });
});
