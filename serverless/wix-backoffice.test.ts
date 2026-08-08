import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - plain ESM worker module
import { handleWixSubmission } from './wix-backoffice.mjs';

const CMS_ENV = {
  WIX_CMS_ENDPOINT: 'https://example.wixsite.com/_functions/ironDominionSubmission',
  IRON_DOMINION_INGEST_SECRET: 'shared-secret',
  // deliberately no WIX_API_KEY: player stats must not depend on it
};

function post(body: unknown): Request {
  return new Request('https://worker.test/api/wix-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function stubCms() {
  const calls: any[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(String(init.body)) });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true}') } as Response);
  });
  return calls;
}

const VALID = { kind: 'player-stat', memberId: 'member-1', nickname: 'Iron Fox', result: 'victory', playMinutes: 10.5 };

afterEach(() => vi.unstubAllGlobals());

describe('worker player-stat submissions', () => {
  it('forwards a valid stat to the CMS endpoint with the shared secret', async () => {
    const calls = stubCms();
    const response = await handleWixSubmission(post(VALID), CMS_ENV);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(CMS_ENV.WIX_CMS_ENDPOINT);
    expect(calls[0].headers['x-iron-dominion-secret']).toBe('shared-secret');
    expect(calls[0].body).toMatchObject({ kind: 'player-stat', memberId: 'member-1', result: 'victory' });
  });

  it('does not require a Wix API key, so stats keep working without forms access', async () => {
    stubCms();
    await expect(handleWixSubmission(post(VALID), CMS_ENV)).resolves.toMatchObject({ status: 200 });
  });

  it('rejects a stat with no member, since there is nothing to aggregate against', async () => {
    stubCms();
    const response = await handleWixSubmission(post({ ...VALID, memberId: '' }), CMS_ENV);
    expect(response.status).toBe(400);
  });

  it('rejects an unfinished or unknown result rather than inventing one', async () => {
    stubCms();
    for (const result of ['ongoing', 'draw', '', undefined]) {
      const response = await handleWixSubmission(post({ ...VALID, result }), CMS_ENV);
      expect(response.status).toBe(400);
    }
  });

  it('clamps play minutes and ace share instead of trusting the client', async () => {
    const calls = stubCms();
    await handleWixSubmission(post({ ...VALID, playMinutes: -5, aceShare: 9 }), CMS_ENV);
    expect(calls[0].body.playMinutes).toBe(0);
    expect(calls[0].body.aceShare).toBe(1);
  });

  it('omits an ace share that was never reported', async () => {
    const calls = stubCms();
    await handleWixSubmission(post(VALID), CMS_ENV);
    expect(calls[0].body.aceShare).toBeUndefined();
  });

  it('carries no match id, map or seed — aggregates only, by construction', async () => {
    const calls = stubCms();
    await handleWixSubmission(post({ ...VALID, matchId: 'match-9', mapId: 'highlands', seed: 42 }), CMS_ENV);
    expect(calls[0].body).not.toHaveProperty('matchId');
    expect(calls[0].body).not.toHaveProperty('mapId');
    expect(calls[0].body).not.toHaveProperty('seed');
  });
});
