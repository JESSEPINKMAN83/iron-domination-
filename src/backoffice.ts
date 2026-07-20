export type BackofficeSubmission =
  | { kind: 'signup'; name: string; email: string; releaseUpdates: boolean; source: string }
  | { kind: 'feedback'; name: string; rating: number; message: string; page: string };

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
