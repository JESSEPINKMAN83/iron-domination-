const STORAGE_KEY = 'iron-dominion.enlisted.v1';
const ENLIST_ENDPOINT = '/api/wix-submit';
const ENLIST_TIMEOUT_MS = 12_000;

/**
 * A player who traded a name and an email for a real Wix site member record.
 *
 * The member is created server-side by the Worker, so the game never renders a
 * password field, never leaves for a login page, and never holds a credential —
 * which is the whole point: a password box on this origin is what got the site
 * flagged as deceptive in the first place.
 *
 * `ticket` is the Worker's signature over `memberId`. It is opaque here: the game
 * only replays it to the relay, which recomputes the same HMAC with the shared
 * secret. That keeps a player from claiming someone else's member id without the
 * relay ever calling Wix.
 */
export interface EnlistedCommander {
  memberId: string;
  name: string;
  ticket: string;
}

export interface EnlistInput {
  name: string;
  email: string;
  releaseUpdates?: boolean;
  source?: string;
}

export type EnlistOutcome =
  | { status: 'enlisted'; commander: EnlistedCommander }
  | { status: 'error'; message: string };

let cached: EnlistedCommander | undefined;

/** Reads the enlistment payload, ignoring anything that is not a usable member. */
export function parseEnlistment(payload: unknown, name: string): EnlistedCommander | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const { memberId, ticket } = payload as { memberId?: unknown; ticket?: unknown };
  if (typeof memberId !== 'string' || !memberId) return undefined;
  if (typeof ticket !== 'string' || !ticket) return undefined;
  const trimmed = name.trim().slice(0, 28);
  return { memberId, ticket, name: trimmed || 'Commander' };
}

export function enlistedCommander(): EnlistedCommander | undefined {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as { name?: string };
    cached = parseEnlistment(stored, typeof stored?.name === 'string' ? stored.name : '');
    return cached;
  } catch {
    return undefined;
  }
}

export function rememberEnlistment(commander: EnlistedCommander): void {
  cached = commander;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(commander));
  } catch {
    // The enlistment still holds for this visit when storage is blocked.
  }
}

/**
 * Turns a name and email into a member, or explains why it could not.
 *
 * Idempotent by construction: enlisting with an email that already has a member
 * returns that same member, so a second device or a double tap is not an error.
 */
export async function enlist(input: EnlistInput): Promise<EnlistOutcome> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) return { status: 'error', message: 'Enter your name and email to enlist.' };

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ENLIST_TIMEOUT_MS);
  try {
    const response = await fetch(ENLIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'enlist',
        name,
        email,
        releaseUpdates: input.releaseUpdates === true,
        source: input.source ?? 'Iron Dominion multiplayer enlistment',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: 'error',
        message: response.status === 400
          ? 'That email does not look right — check it and try again.'
          : 'We could not set up your commander account. Try again in a moment.',
      };
    }
    const commander = parseEnlistment(await response.json(), name);
    if (!commander) {
      return { status: 'error', message: 'We could not set up your commander account. Try again in a moment.' };
    }
    rememberEnlistment(commander);
    return { status: 'enlisted', commander };
  } catch {
    return { status: 'error', message: 'We could not reach the server. Check your connection and try again.' };
  } finally {
    window.clearTimeout(timeout);
  }
}
