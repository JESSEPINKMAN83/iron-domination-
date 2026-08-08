/**
 * Wix Headless OAuth client ID. Public by design — headless OAuth has no client
 * secret — so it ships in the bundle and is set at build time:
 *
 *   VITE_WIX_CLIENT_ID=... npm run build
 *
 * While it is unset, member auth stays completely inert and the game falls back to
 * the local signup profile. That is the safety property: an unconfigured build
 * behaves exactly like the pre-member game rather than failing at runtime.
 */
const CLIENT_ID = String(import.meta.env?.VITE_WIX_CLIENT_ID ?? '').trim();

export function wixClientId(): string {
  return CLIENT_ID;
}

export function memberAuthConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

/**
 * Must exactly match an allowed authorization redirect URI in Headless Settings —
 * trailing slashes included, which is the most common cause of a broken login.
 * Bare origin on purpose: Wix returns to the game's normal entry point with `code`
 * and `state` in the query string, so no dedicated callback route has to exist on
 * the Worker.
 */
export function authRedirectUri(): string {
  return location.origin;
}

export function postLogoutUri(): string {
  return location.origin;
}
