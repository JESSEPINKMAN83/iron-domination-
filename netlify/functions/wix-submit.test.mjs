import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { clearFormSummaryCache } from './wix-submit.mjs';

const originalEnv = { ...process.env };

function wixResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  clearFormSummaryCache();
  process.env.WIX_API_KEY = 'test-api-key';
  process.env.WIX_SITE_ID = 'test-site';
  process.env.WIX_CMS_ENDPOINT = 'https://wix.test/_functions/ironDominionSubmission';
  process.env.IRON_DOMINION_INGEST_SECRET = 'test-ingest-secret';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe('wix-submit Netlify function', () => {
  it('maps a beta signup to its Wix form and creates a contact', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(wixResponse({
        formSummary: {
          fields: [
            { target: 'contact.name', label: 'Name', type: 'STRING' },
            { target: 'contact.email', label: 'Email', type: 'EMAIL' },
            { target: 'release_updates', label: 'Release updates', type: 'BOOLEAN' },
          ],
        },
      }))
      .mockResolvedValueOnce(wixResponse({ contact: { id: 'contact-1' } }))
      .mockResolvedValueOnce(wixResponse({ submission: { id: 'submission-1' } }))
      .mockResolvedValueOnce(wixResponse({ ok: true }, 201));

    const response = await handler(new Request('https://game.test/.netlify/functions/wix-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'signup',
        name: 'Ada Lovelace',
        email: 'ADA@example.com',
        releaseUpdates: true,
        source: 'Iron Dominion landing page',
      }),
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const contactBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(contactBody.info.emails.items[0].email).toBe('ada@example.com');
    const submissionBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(submissionBody.submission.submissions).toEqual({
      'contact.name': 'Ada Lovelace',
      'contact.email': 'ada@example.com',
      release_updates: true,
    });
    expect(fetchMock.mock.calls[3][0]).toBe('https://wix.test/_functions/ironDominionSubmission');
    expect(fetchMock.mock.calls[3][1].headers['x-iron-dominion-secret']).toBe('test-ingest-secret');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      kind: 'signup',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      releaseUpdates: true,
      source: 'Iron Dominion landing page',
    });
  });

  it('maps player feedback without creating a contact', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(wixResponse({
        formSummary: {
          fields: [
            { target: 'player_name', label: 'Player name', type: 'STRING' },
            { target: 'rating', label: 'Rating', type: 'RATING' },
            {
              target: 'feedback',
              label: 'Describe the battle in your own words',
              type: 'STRING',
            },
            { target: 'page_url', label: 'Page URL', type: 'URL' },
          ],
        },
      }))
      .mockResolvedValueOnce(wixResponse({ submission: { id: 'submission-2' } }))
      .mockResolvedValueOnce(wixResponse({ ok: true }, 201));

    const response = await handler(new Request('https://game.test/.netlify/functions/wix-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'feedback',
        name: 'Player One',
        rating: 4,
        message: 'The battle was excellent.',
        page: 'https://game.test/?map=frost',
        match: {
          matchId: 'match-123',
          status: 'victory',
          multiplayer: true,
          roomCode: 'ABCD',
          mapId: 'frostbite-pass',
          mapSize: 'medium',
          seed: 771204,
          playerName: 'Player One',
          playerTeam: 1,
          playerSide: 1,
          elapsedSeconds: 523.27,
          fps: 58.84,
          pingMs: 72.4,
          quality: 'balanced',
          renderScale: 0.85,
          engine: 'chrome',
          buildVersion: '0.1.0',
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const submissionBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(submissionBody.submission.submissions).toEqual({
      player_name: 'Player One',
      rating: 4,
      feedback: 'The battle was excellent.',
      page_url: 'https://game.test/?map=frost',
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      kind: 'feedback',
      name: 'Player One',
      message: 'The battle was excellent.',
      rating: 4,
      page: 'https://game.test/?map=frost',
      match: {
        matchId: 'match-123',
        status: 'victory',
        multiplayer: true,
        roomCode: 'ABCD',
        mapId: 'frostbite-pass',
        mapSize: 'medium',
        seed: 771204,
        playerName: 'Player One',
        playerTeam: 1,
        playerSide: 1,
        elapsedSeconds: 523.3,
        fps: 58.8,
        pingMs: 72,
        quality: 'balanced',
        renderScale: 0.85,
        engine: 'chrome',
        buildVersion: '0.1.0',
      },
    });
  });

  it('rejects invalid payloads before calling Wix', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await handler(new Request('https://game.test/.netlify/functions/wix-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'signup', name: '', email: 'not-an-email' }),
    }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
