const STORAGE_KEY = 'iron-dominion.identity.v1';
const DEFAULT_ENABLED = true;

let resolved: boolean | undefined;

function persist(value: 'on' | 'off'): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // The switch still applies to this visit when storage is unavailable.
  }
}

function storedOverride(): boolean | undefined {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'on') return true;
    if (stored === 'off') return false;
  } catch {
    // Fall through to the default.
  }
  return undefined;
}

/**
 * Runtime kill switch for the member-identity flow. `?identity=0` restores the
 * pre-identity landing page (single gated "Play game" CTA) and sticks for the
 * browser, so a bad rollout is undone without a deploy. `?identity=1` re-enables it.
 */
export function identityEnabled(): boolean {
  if (resolved !== undefined) return resolved;
  const param = new URLSearchParams(location.search).get('identity');
  if (param === '0' || param === 'off') {
    persist('off');
    resolved = false;
  } else if (param === '1' || param === 'on') {
    persist('on');
    resolved = true;
  } else {
    resolved = storedOverride() ?? DEFAULT_ENABLED;
  }
  return resolved;
}
