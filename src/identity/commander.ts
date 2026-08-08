import { cachedMemberProfile } from './session';

const PROFILE_STORAGE_KEY = 'iron-dominion.beta-profile.v1';

/**
 * How the player is presented in the game. `source` records where it came from:
 * a signed-in Wix member, or the locally stored signup profile when member auth
 * is unconfigured or the player is signed out. Every consumer renders the same
 * shape either way.
 */
export interface CommanderIdentity {
  name: string;
  initials: string;
  accent: string;
  source: 'local' | 'member';
}

const ACCENTS = ['#d2b15f', '#7fbf8a', '#79a9d8', '#d98d6a', '#b79ad8', '#6fc3c0', '#d8a0b4', '#c2c96f'];

interface StoredProfile {
  name?: string;
  email?: string;
}

function storedProfile(): StoredProfile | undefined {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredProfile | null) : null;
    return parsed ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberLocalCommander(profile: { name: string; email: string }): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // The name is simply unavailable next visit when storage is blocked.
  }
}

export function commanderName(): string | undefined {
  const name = storedProfile()?.name?.trim();
  return name ? name.slice(0, 28) : undefined;
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return `${first}${second}`.toUpperCase() || '?';
}

/** Stable per identity, so a player keeps the same colour on every device. */
function accentFor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) % 100_003;
  return ACCENTS[hash % ACCENTS.length]!;
}

function identityFrom(name: string, key: string, source: CommanderIdentity['source']): CommanderIdentity {
  return { name, initials: initialsFor(name), accent: accentFor(key.toLowerCase()), source };
}

/**
 * Prefers the signed-in Wix member, falling back to the locally stored signup
 * profile. Synchronous on purpose so render paths never await — the member profile
 * is fetched once during boot and cached.
 */
export function currentCommander(): CommanderIdentity | undefined {
  const member = cachedMemberProfile();
  if (member) {
    const name = member.nickname?.trim() || member.firstName?.trim() || member.loginEmail?.split('@')[0] || 'Commander';
    return identityFrom(name.slice(0, 28), member.id, 'member');
  }
  const name = commanderName();
  if (!name) return undefined;
  return identityFrom(name, storedProfile()?.email || name, 'local');
}

/**
 * Monogram avatar: initials over a colour derived from the identity. Deliberately
 * asset-free so it can never fail to load; a portrait picker can replace the inner
 * content later without changing any call site.
 */
export function createCommanderAvatar(identity: CommanderIdentity, size = 40): HTMLElement {
  const avatar = document.createElement('span');
  avatar.className = 'commander-chip__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = identity.initials;
  avatar.style.cssText =
    `width:${size}px;height:${size}px;flex:0 0 ${size}px;display:grid;place-items:center;border-radius:50%;` +
    `background:radial-gradient(circle at 32% 28%,${identity.accent},rgba(12,16,15,.9));` +
    `box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 2px 10px rgba(0,0,0,.45);` +
    `color:#12160f;font:800 ${Math.round(size * 0.4)}px/1 ui-monospace,Menlo,monospace;letter-spacing:.02em;`;
  return avatar;
}

export interface LobbyAvatarOptions {
  name: string;
  seed: string;
  isAi?: boolean;
  verified?: boolean;
  size?: number;
}

export interface LobbyAvatarModel {
  identity: CommanderIdentity;
  title: string;
  badge: boolean;
}

/**
 * The presentation of someone who is not the local player — a lobby opponent or an
 * AI. Derived from a name plus a stable seed so two players never collide on a
 * colour. Kept free of the DOM so it can be tested without a browser environment.
 */
export function lobbyAvatarModel(options: LobbyAvatarOptions): LobbyAvatarModel {
  const verified = options.verified === true && !options.isAi;
  return {
    identity: options.isAi
      ? { name: options.name, initials: 'AI', accent: '#8b948e', source: 'local' }
      : identityFrom(options.name, options.seed, verified ? 'member' : 'local'),
    title: options.isAi
      ? 'Computer opponent'
      : `${options.name} · ${verified ? 'verified account' : 'guest'}`,
    badge: verified,
  };
}

export function renderLobbyAvatar(host: HTMLElement, options: LobbyAvatarOptions): void {
  const model = lobbyAvatarModel(options);
  host.replaceChildren();
  host.classList.toggle('is-verified', model.badge);
  host.title = model.title;
  host.append(createCommanderAvatar(model.identity, options.size ?? 30));
  if (!model.badge) return;
  const badge = document.createElement('span');
  badge.className = 'war-lobby__avatar-badge';
  badge.textContent = '✓';
  badge.setAttribute('aria-label', 'Verified account');
  host.append(badge);
}

export function createCommanderChip(
  identity: CommanderIdentity,
  options: { size?: number; label?: string } = {},
): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'commander-chip';
  const text = document.createElement('span');
  text.className = 'commander-chip__text';
  const label = document.createElement('small');
  label.textContent = options.label ?? 'COMMANDER';
  const name = document.createElement('strong');
  name.textContent = identity.name;
  text.append(label, name);
  chip.append(createCommanderAvatar(identity, options.size ?? 40), text);
  return chip;
}
