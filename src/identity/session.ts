import { authRedirectUri, memberAuthConfigured, postLogoutUri, wixClientId } from './config';
import {
  createLoginUrl,
  createPkceChallenge,
  exchangeCodeForTokens,
  fetchCurrentMember,
  renewTokens,
  visitorTokens,
  type MemberProfile,
  type OAuthTokens,
} from './wixAuth';

const TOKENS_KEY = 'iron-dominion.wix-session.v1';
const PENDING_KEY = 'iron-dominion.wix-pending.v1';
const TOKEN_SKEW_MS = 60_000;

/** What the player was doing when the login redirect took the page away. */
export interface PendingIntent {
  action: 'multiplayer' | 'single';
  roomCode?: string;
}

interface PendingAuth extends PendingIntent {
  codeVerifier: string;
  state: string;
}

export type SignInResult = { status: 'redirecting' } | { status: 'error'; message: string };

let cachedTokens: OAuthTokens | undefined;
let cachedMember: MemberProfile | undefined;
let visitorToken: string | undefined;

function readJson<T>(storage: Storage, key: string): T | undefined {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Sign-in still completes for this visit when storage is unavailable.
  }
}

function clear(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do — the value simply outlives the session.
  }
}

function storeTokens(tokens: OAuthTokens | undefined): void {
  cachedTokens = tokens;
  if (!tokens) {
    clear(window.localStorage, TOKENS_KEY);
    return;
  }
  writeJson(window.localStorage, TOKENS_KEY, tokens);
}

async function visitorAccessToken(): Promise<string> {
  if (visitorToken) return visitorToken;
  const tokens = await visitorTokens(wixClientId());
  visitorToken = tokens.accessToken;
  return visitorToken;
}

/** A valid member access token, renewed if it is close to expiry. Undefined when signed out. */
export async function memberAccessToken(): Promise<string | undefined> {
  const tokens = cachedTokens ?? readJson<OAuthTokens>(window.localStorage, TOKENS_KEY);
  if (!tokens?.refreshToken) return undefined;
  cachedTokens = tokens;
  if (tokens.accessToken && tokens.expiresAt - TOKEN_SKEW_MS > Date.now()) return tokens.accessToken;
  try {
    const renewed = await renewTokens(tokens.refreshToken);
    storeTokens(renewed);
    return renewed.accessToken;
  } catch {
    // The refresh token is spent or revoked: fall back to signed out rather than looping.
    storeTokens(undefined);
    cachedMember = undefined;
    return undefined;
  }
}

export function isMemberSignedIn(): boolean {
  if (!memberAuthConfigured()) return false;
  const tokens = cachedTokens ?? readJson<OAuthTokens>(window.localStorage, TOKENS_KEY);
  return Boolean(tokens?.refreshToken);
}

export function cachedMemberProfile(): MemberProfile | undefined {
  return cachedMember;
}

export async function currentMemberProfile(): Promise<MemberProfile | undefined> {
  if (!memberAuthConfigured()) return undefined;
  if (cachedMember) return cachedMember;
  const token = await memberAccessToken();
  if (!token) return undefined;
  cachedMember = await fetchCurrentMember(token);
  if (!cachedMember) storeTokens(undefined);
  return cachedMember;
}

/**
 * Sends the player to Wix's own login page. Nothing about the credential step happens
 * on our origin — we hand out a PKCE challenge and get an authorization code back.
 */
export async function startHostedLogin(intent: PendingIntent): Promise<SignInResult> {
  if (!memberAuthConfigured()) return { status: 'error', message: 'Accounts are not configured for this build.' };
  try {
    const pkce = await createPkceChallenge();
    const pending: PendingAuth = { ...intent, codeVerifier: pkce.verifier, state: pkce.state };
    writeJson(window.sessionStorage, PENDING_KEY, pending);
    const url = await createLoginUrl(await visitorAccessToken(), {
      clientId: wixClientId(),
      redirectUri: authRedirectUri(),
      pkce,
    });
    location.href = url;
    return { status: 'redirecting' };
  } catch {
    clear(window.sessionStorage, PENDING_KEY);
    return { status: 'error', message: 'We could not reach the sign-in service. Check your connection and try again.' };
  }
}

/**
 * Boot step: finish a login that took the page away, and restore an existing session.
 * Returns the intent the player had before the redirect so the caller can resume it.
 * Never throws — a failed restore just means "signed out".
 */
export async function restoreMemberSession(): Promise<PendingIntent | undefined> {
  if (!memberAuthConfigured()) return undefined;
  // Wix returns the code in the fragment, which keeps it out of server logs and
  // Referer headers. Query is still read so an older in-flight login can complete.
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const code = fragment.get('code') ?? query.get('code');
  const state = fragment.get('state') ?? query.get('state');
  const pending = readJson<PendingAuth>(window.sessionStorage, PENDING_KEY);

  if (code && state && pending) {
    clear(window.sessionStorage, PENDING_KEY);
    // Strip the auth values so a refresh cannot replay them.
    query.delete('code');
    query.delete('state');
    const search = query.toString();
    history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}`);
    if (state !== pending.state) return undefined;
    try {
      const tokens = await exchangeCodeForTokens({
        clientId: wixClientId(),
        code,
        codeVerifier: pending.codeVerifier,
        redirectUri: authRedirectUri(),
      });
      storeTokens(tokens);
      cachedMember = await fetchCurrentMember(tokens.accessToken);
      return { action: pending.action, roomCode: pending.roomCode };
    } catch {
      return undefined;
    }
  }

  await currentMemberProfile();
  return undefined;
}

export async function signOutCommander(): Promise<void> {
  const token = await memberAccessToken();
  storeTokens(undefined);
  cachedMember = undefined;
  if (!token) return;
  try {
    const { createLogoutUrl } = await import('./wixAuth');
    location.href = await createLogoutUrl(token, { clientId: wixClientId(), postFlowUrl: postLogoutUri() });
  } catch {
    location.reload();
  }
}
