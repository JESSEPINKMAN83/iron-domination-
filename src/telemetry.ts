import type { FeedbackMatchMetadata } from './backoffice';

export type TelemetryEventName =
  | 'session-start'
  | 'match-start'
  | 'match-end'
  | 'heartbeat'
  | 'tactic-open'
  | 'tactic-cancel'
  | 'tactic-execute'
  | 'tactic-complete'
  | 'tactic-interrupted'
  | 'tactic-feedback';

export type TacticTelemetryFeature = {
  unitCount?: number;
  selectionCount?: number;
  unitKinds?: string;
  waypointCount?: number;
  pathLengthApprox?: number;
  endAction?: 'hold' | 'attack-move' | 'attack';
  plannerDurationMs?: number;
  subsetOfSelection?: boolean;
  useful?: boolean;
  rankRecruitShare?: number;
  rankVeteranShare?: number;
  rankEliteShare?: number;
  rankAceShare?: number;
  rankCounts?: string;
  combatUnitCount?: number;
};

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

export function sendTelemetryEvent(
  event: TelemetryEventName,
  match?: FeedbackMatchMetadata,
  feature?: TacticTelemetryFeature,
): void {
  const payload = JSON.stringify({
    kind: 'telemetry',
    event,
    playerId: telemetryPlayerId(),
    page: location.href,
    buildVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
    match,
    feature: feature && Object.keys(feature).length > 0 ? feature : undefined,
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

export function trackMatchTelemetry(
  matchMetadata: () => FeedbackMatchMetadata,
  featureAtEnd?: () => TacticTelemetryFeature | undefined,
): MatchTelemetry {
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
      sendTelemetryEvent('match-end', matchMetadata(), featureAtEnd?.());
    },
  };
}

export function summarizeUnitKinds(kinds: string[]): string {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kind, count]) => `${kind}:${count}`)
    .join(',');
}

export function approximatePathLength(waypoints: Array<{ x: number; z: number }>): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].z - waypoints[i - 1].z);
  }
  return Math.round(total);
}
