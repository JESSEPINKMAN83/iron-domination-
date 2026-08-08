import { authRedirectUri, memberAuthConfigured, postLogoutUri, wixClientId } from './config';
import {
  createAuthorizeUrl,
  createPkceChallenge,
  exchangeCodeForTokens,
  fetchCurrentMember,
  loginMember,
  registerMember,
  renewTokens,
  sendRecoveryEmail,
  verifyEmailCode,
  visitorTokens,
  WixAuthError,
  type AuthOutcome,
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

export type SignInResult =
  | { status: 'redirecting' }
  | { status: 'verify-email'; stateToken: string }
  | { status: 'owner-approval' }
  | { status: 'error'; message: string };

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

async function beginRedirect(sessionToken: string, intent: PendingIntent): Promise<SignInResult> {
  const pkce = await createPkceChallenge();
  const pending: PendingAuth = { ...intent, codeVerifier: pkce.verifier, state: pkce.state };
  writeJson(window.sessionStorage, PENDING_KEY, pending);
  const url = await createAuthorizeUrl(await visitorAccessToken(), {
    clientId: wixClientId(),
    sessionToken,
    redirectUri: authRedirectUri(),
    pkce,
  });
  location.href = url;
  return { status: 'redirecting' };
}

function describeError(error: unknown): SignInResult {
  if (error instanceof WixAuthError) {
    const friendly: Record<string, string> = {
      invalid_password: 'That password is not accepted. Use at least 8 characters.',
      invalidPassword: 'Wrong email or password.',
      invalidEmail: 'That email address does not look right.',
      emailAlreadyExists: 'That email is already registered — log in instead.',
    };
    return { status: 'error', message: friendly[error.code] ?? error.message };
  }
  return { status: 'error', message: 'We could not reach the account service. Check your connection and try again.' };
}

async function completeOutcome(outcome: AuthOutcome, intent: PendingIntent): Promise<SignInResult> {
  if (outcome.status === 'success') return beginRedirect(outcome.sessionToken, intent);
  if (outcome.status === 'verify-email') return { status: 'verify-email', stateToken: outcome.stateToken };
  if (outcome.status === 'owner-approval') return { status: 'owner-approval' };
  return { status: 'error', message: outcome.message };
}

export async function signUpCommander(
  input: { email: string; password: string; name?: string },
  intent: PendingIntent,
): Promise<SignInResult> {
  try {
    const outcome = await registerMember(await visitorAccessToken(), {
      email: input.email,
      password: input.password,
      nickname: input.name,
      firstName: input.name?.split(/\s+/)[0],
    });
    return await completeOutcome(outcome, intent);
  } catch (error) {
    return describeError(error);
  }
}

export async function signInCommander(
  input: { email: string; password: string },
  intent: PendingIntent,
): Promise<SignInResult> {
  try {
    return await completeOutcome(await loginMember(await visitorAccessToken(), input), intent);
  } catch (error) {
    return describeError(error);
  }
}

export async function submitVerificationCode(
  input: { code: string; stateToken: string },
  intent: PendingIntent,
): Promise<SignInResult> {
  try {
    return await completeOutcome(await verifyEmailCode(await visitorAccessToken(), input), intent);
  } catch (error) {
    return describeError(error);
  }
}

export async function requestPasswordReset(email: string): Promise<boolean> {
  try {
    await sendRecoveryEmail(await visitorAccessToken(), {
      clientId: wixClientId(),
      email,
      redirectUrl: postLogoutUri(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot step: finish a login that took the page away, and restore an existing session.
 * Returns the intent the player had before the redirect so the caller can resume it.
 * Never throws — a failed restore just means "signed out".
 */
export async function restoreMemberSession(): Promise<PendingIntent | undefined> {
  if (!memberAuthConfigured()) return undefined;
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  const pending = readJson<PendingAuth>(window.sessionStorage, PENDING_KEY);

  if (code && state && pending) {
    clear(window.sessionStorage, PENDING_KEY);
    // Strip the auth params so a refresh cannot replay them.
    params.delete('code');
    params.delete('state');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
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
