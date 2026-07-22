import type { FeedbackMatchMetadata } from './backoffice';

export type TelemetryEventName = 'session-start' | 'match-start' | 'match-end' | 'heartbeat';

const TELEMETRY_ENDPOINT = '/api/wix-submit';
const PLAYER_ID_STORAGE_KEY = 'iron-dominion.player-id.v1';
const HEARTBEAT_INTERVAL_MS = 120_000;

let cachedPlayerId: string | undefined;

export function telemetryPlayerId(): string {
  if (cachedPlayerId) return cachedPlayerId;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(PLAYER_ID_STORAGE_KEY);
  } catch {
    // Storage unavailable: the id below still identifies this visit.
  }
  cachedPlayerId = stored && /^[0-9a-f-]{36}$/.test(stored) ? stored : crypto.randomUUID();
  if (cachedPlayerId !== stored) {
    try {
      window.localStorage.setItem(PLAYER_ID_STORAGE_KEY, cachedPlayerId);
    } catch {
      // Same: id lasts for this visit only.
    }
  }
  return cachedPlayerId;
}

export function sendTelemetryEvent(event: TelemetryEventName, match?: FeedbackMatchMetadata): void {
  const payload = JSON.stringify({
    kind: 'telemetry',
    event,
    playerId: telemetryPlayerId(),
    page: location.href,
    buildVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
    match,
  });
  // sendBeacon survives tab close, which fetch cannot guarantee.
  try {
    if (navigator.sendBeacon(TELEMETRY_ENDPOINT, new Blob([payload], { type: 'application/json' }))) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

export interface MatchTelemetry {
  end(): void;
}

export function trackMatchTelemetry(matchMetadata: () => FeedbackMatchMetadata): MatchTelemetry {
  sendTelemetryEvent('match-start', matchMetadata());
  let ended = false;
  const interval = window.setInterval(() => sendTelemetryEvent('heartbeat', matchMetadata()), HEARTBEAT_INTERVAL_MS);
  // A last beacon on tab close records how long abandoned matches lasted.
  const onPageHide = (): void => {
    if (!ended) sendTelemetryEvent('heartbeat', matchMetadata());
  };
  window.addEventListener('pagehide', onPageHide);
  return {
    end(): void {
      if (ended) return;
      ended = true;
      window.clearInterval(interval);
      window.removeEventListener('pagehide', onPageHide);
      sendTelemetryEvent('match-end', matchMetadata());
    },
  };
}
