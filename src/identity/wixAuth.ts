/**
 * Wix Headless member authentication over the REST API.
 *
 * Deliberately dependency-free: every call here is documented plain JSON, so the
 * game bundle gains no SDK. This module touches no DOM and no storage — it is the
 * transport layer, and `session.ts` owns persistence — which also keeps it unit
 * testable without a browser environment.
 *
 * Endpoints (see WIX_MEMBER_IDENTITY_PLAN.md for the flow):
 *   POST /oauth2/token                              visitor token, refresh, code exchange
 *   POST /_api/iam/authentication/v2/register       sign up
 *   POST /_api/iam/authentication/v2/login          sign in
 *   POST /_api/iam/verification/v1/auth/verify      email verification code
 *   POST /_api/redirects-api/v1/redirect-session    PKCE authorize + logout URLs
 *   POST /_api/iam/recovery/v1/send-email           password reset
 *   GET  /members/v1/members/my                     current member profile
 */

const WIX_API = 'https://www.wixapis.com';
const AUTH_TIMEOUT_MS = 12_000;

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type AuthOutcome =
  | { status: 'success'; sessionToken: string }
  | { status: 'verify-email'; stateToken: string }
  | { status: 'owner-approval' }
  | { status: 'error'; code: string; message: string };

export interface MemberProfile {
  id: string;
  loginEmail?: string;
  emailVerified: boolean;
  nickname?: string;
  firstName?: string;
  status?: string;
}

export interface PkceChallenge {
  verifier: string;
  challenge: string;
  state: string;
}

export class WixAuthError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'WixAuthError';
  }
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createPkceChallenge(): Promise<PkceChallenge> {
  const verifier = randomHex(32);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(digest), state: randomHex(16) };
}

async function post(path: string, body: unknown, accessToken?: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${WIX_API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { authorization: accessToken } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new WixAuthError(
        String(parsed?.message ?? parsed?.error_description ?? `Request failed (${response.status})`),
        String(parsed?.details?.applicationError?.code ?? parsed?.error ?? `http_${response.status}`),
      );
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function toTokens(payload: any): OAuthTokens {
  return {
    accessToken: String(payload.access_token ?? ''),
    refreshToken: String(payload.refresh_token ?? ''),
    expiresAt: Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000,
  };
}

export async function visitorTokens(clientId: string): Promise<OAuthTokens> {
  return toTokens(await post('/oauth2/token', { clientId, grantType: 'anonymous' }));
}

export async function renewTokens(refreshToken: string): Promise<OAuthTokens> {
  // The token endpoint mixes cases here: `refresh_token` but `grantType`. Copied from the docs.
  return toTokens(await post('/oauth2/token', { refresh_token: refreshToken, grantType: 'refresh_token' }));
}

/** Register and login share a response envelope, so they share the interpretation. */
function readAuthOutcome(payload: any): AuthOutcome {
  const state = String(payload?.state ?? '');
  if (state === 'SUCCESS') return { status: 'success', sessionToken: String(payload.sessionToken ?? '') };
  if (state === 'REQUIRE_EMAIL_VERIFICATION') return { status: 'verify-email', stateToken: String(payload.stateToken ?? '') };
  if (state === 'REQUIRE_OWNER_APPROVAL') return { status: 'owner-approval' };
  return { status: 'error', code: state || 'unknown_state', message: 'Unexpected authentication state.' };
}

export async function registerMember(
  visitorAccessToken: string,
  input: { email: string; password: string; nickname?: string; firstName?: string },
): Promise<AuthOutcome> {
  const profile: Record<string, string> = {};
  if (input.firstName) profile.firstName = input.firstName;
  if (input.nickname) profile.nickname = input.nickname;
  const payload = await post(
    '/_api/iam/authentication/v2/register',
    { loginId: { email: input.email }, password: input.password, ...(Object.keys(profile).length ? { profile } : {}) },
    visitorAccessToken,
  );
  return readAuthOutcome(payload);
}

export async function loginMember(
  visitorAccessToken: string,
  input: { email: string; password: string },
): Promise<AuthOutcome> {
  const payload = await post(
    '/_api/iam/authentication/v2/login',
    { loginId: { email: input.email }, password: input.password },
    visitorAccessToken,
  );
  return readAuthOutcome(payload);
}

export async function verifyEmailCode(
  visitorAccessToken: string,
  input: { code: string; stateToken: string },
): Promise<AuthOutcome> {
  const payload = await post(
    '/_api/iam/verification/v1/auth/verify',
    { code: input.code, stateToken: input.stateToken },
    visitorAccessToken,
  );
  return readAuthOutcome(payload);
}

/**
 * Full-page redirect authorization. The iframe (`web_message`) variant is avoided on
 * purpose: it breaks on mobile browsers that block third-party cookies, which is most
 * of them.
 */
export async function createAuthorizeUrl(
  visitorAccessToken: string,
  input: { clientId: string; sessionToken: string; redirectUri: string; pkce: PkceChallenge },
): Promise<string> {
  const payload = await post(
    '/_api/redirects-api/v1/redirect-session',
    {
      auth: {
        authRequest: {
          clientId: input.clientId,
          codeChallenge: input.pkce.challenge,
          codeChallengeMethod: 'S256',
          responseMode: 'query',
          responseType: 'code',
          scope: 'offline_access',
          state: input.pkce.state,
          sessionToken: input.sessionToken,
          redirectUri: input.redirectUri,
        },
      },
    },
    visitorAccessToken,
  );
  const url = String(payload?.redirectSession?.fullUrl ?? '');
  if (!url) throw new WixAuthError('Wix did not return an authorization URL.', 'no_authorize_url');
  return url;
}

export async function exchangeCodeForTokens(input: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<OAuthTokens> {
  return toTokens(
    await post('/oauth2/token', {
      clientId: input.clientId,
      grantType: 'authorization_code',
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
    }),
  );
}

export async function sendRecoveryEmail(
  visitorAccessToken: string,
  input: { clientId: string; email: string; redirectUrl: string },
): Promise<void> {
  await post(
    '/_api/iam/recovery/v1/send-email',
    { email: input.email, redirect: { url: input.redirectUrl, clientId: input.clientId } },
    visitorAccessToken,
  );
}

export async function createLogoutUrl(
  accessToken: string,
  input: { clientId: string; postFlowUrl: string },
): Promise<string> {
  const payload = await post(
    '/_api/redirects-api/v1/redirect-session',
    { logout: { clientId: input.clientId }, callbacks: { postFlowUrl: input.postFlowUrl } },
    accessToken,
  );
  return String(payload?.redirectSession?.fullUrl ?? input.postFlowUrl);
}

export async function fetchCurrentMember(memberAccessToken: string): Promise<MemberProfile | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${WIX_API}/members/v1/members/my?fieldSet=FULL`, {
      headers: { authorization: memberAccessToken },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const member = (await response.json())?.member;
    if (!member?.id) return undefined;
    return {
      id: String(member.id),
      loginEmail: member.loginEmail ? String(member.loginEmail) : undefined,
      emailVerified: member.loginEmailVerified === true,
      nickname: member.profile?.nickname ? String(member.profile.nickname) : undefined,
      firstName: member.contact?.firstName ? String(member.contact.firstName) : undefined,
      status: member.status ? String(member.status) : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}
