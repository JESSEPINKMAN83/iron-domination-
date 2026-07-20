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
      .mockResolvedValueOnce(wixResponse({ submission: { id: 'submission-1' } }));

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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const contactBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(contactBody.info.emails.items[0].email).toBe('ada@example.com');
    const submissionBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(submissionBody.submission.submissions).toEqual({
      'contact.name': 'Ada Lovelace',
      'contact.email': 'ada@example.com',
      release_updates: true,
    });
  });

  it('maps player feedback without creating a contact', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(wixResponse({
        formSummary: {
          fields: [
            { target: 'player_name', label: 'Player name', type: 'STRING' },
            { target: 'rating', label: 'Rating', type: 'RATING' },
            { target: 'feedback', label: 'Feedback', type: 'STRING' },
            { target: 'page_url', label: 'Page URL', type: 'URL' },
          ],
        },
      }))
      .mockResolvedValueOnce(wixResponse({ submission: { id: 'submission-2' } }));

    const response = await handler(new Request('https://game.test/.netlify/functions/wix-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'feedback',
        name: 'Player One',
        rating: 4,
        message: 'The battle was excellent.',
        page: 'https://game.test/?map=frost',
      }),
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const submissionBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(submissionBody.submission.submissions).toEqual({
      player_name: 'Player One',
      rating: 4,
      feedback: 'The battle was excellent.',
      page_url: 'https://game.test/?map=frost',
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
