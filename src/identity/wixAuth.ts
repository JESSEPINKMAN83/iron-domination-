/**
 * Wix Headless member authentication over the REST API, using a Wix-hosted login
 * page.
 *
 * The game deliberately never renders a password field. Chrome flagged the previous
 * custom login panel as a deceptive site — an unbranded workers.dev origin asking
 * for credentials that belong to another service is the textbook phishing shape, and
 * players were shown a full "Dangerous" interstitial. Handing the credential step to
 * Wix's own domain removes the signal at its source rather than appealing it.
 *
 * Deliberately dependency-free: every call here is documented plain JSON, so the
 * game bundle gains no SDK. This module touches no DOM and no storage — it is the
 * transport layer, and `session.ts` owns persistence — which also keeps it unit
 * testable without a browser environment.
 *
 * Endpoints (see WIX_MEMBER_IDENTITY_PLAN.md for the flow):
 *   POST /oauth2/token                              visitor token, refresh, code exchange
 *   POST /_api/redirects-api/v1/redirect-session    hosted login and logout URLs
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


/**
 * URL of the Wix-hosted login page. No session token is involved: Wix collects the
 * credentials on its own domain and returns an authorization code.
 *
 * `responseMode: 'fragment'` keeps the code out of the query string, so it never
 * reaches a server log or a Referer header on the way back.
 */
export async function createLoginUrl(
  visitorAccessToken: string,
  input: { clientId: string; redirectUri: string; pkce: PkceChallenge },
): Promise<string> {
  const payload = await post(
    '/_api/redirects-api/v1/redirect-session',
    {
      auth: {
        authRequest: {
          clientId: input.clientId,
          codeChallenge: input.pkce.challenge,
          codeChallengeMethod: 'S256',
          responseMode: 'fragment',
          responseType: 'code',
          scope: 'offline_access',
          state: input.pkce.state,
          redirectUri: input.redirectUri,
        },
      },
    },
    visitorAccessToken,
  );
  const url = String(payload?.redirectSession?.fullUrl ?? '');
  if (!url) throw new WixAuthError('Wix did not return a login URL.', 'no_login_url');
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
