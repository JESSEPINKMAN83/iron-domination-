export interface FeedbackMatchMetadata {
  matchId: string;
  status: 'ongoing' | 'victory' | 'defeat';
  multiplayer: boolean;
  roomCode?: string;
  mapId: string;
  mapSize: string;
  seed: number;
  playerName?: string;
  playerTeam: number;
  playerSide: number;
  elapsedSeconds: number;
  fps: number;
  pingMs?: number;
  quality: string;
  renderScale: number;
  engine?: string;
  buildVersion: string;
}

export type BackofficeSubmission =
  | { kind: 'signup'; name: string; email: string; releaseUpdates: boolean; source: string }
  | { kind: 'feedback'; name: string; rating: number; message: string; page: string; match?: FeedbackMatchMetadata };

const WIX_SUBMIT_ENDPOINT = '/api/wix-submit';

export async function submitToBackoffice(submission: BackofficeSubmission): Promise<boolean> {
  try {
    const response = await fetch(WIX_SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(submission),
    });
    return response.ok;
  } catch {
    return false;
  }
}
