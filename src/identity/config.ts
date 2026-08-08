/**
 * Wix Headless OAuth client ID for the "Iron Dominion Game" client.
 *
 * Committed on purpose: headless OAuth has no client secret and Wix documents the
 * client ID as safe for frontend calls, so baking it in removes a whole class of
 * "the deploy forgot the env var" failures. VITE_WIX_CLIENT_ID still overrides it
 * for a different project or a staging client.
 *
 * Set it to an empty string to switch member auth off entirely: every entry point
 * then falls back to the local signup profile, exactly like the pre-member game.
 *
 * Allowed authorization redirect URIs registered for this client:
 *   https://throbbing-truth-af19.danireuven.workers.dev
 *   http://localhost:5173
 *   http://localhost:5180
 */
const DEFAULT_CLIENT_ID = 'b44e4271-f0f3-49de-9494-8902632d240c';

const CLIENT_ID = String(import.meta.env?.VITE_WIX_CLIENT_ID ?? DEFAULT_CLIENT_ID).trim();

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
