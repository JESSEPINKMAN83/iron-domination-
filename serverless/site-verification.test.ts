import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM worker module
import { siteVerificationResponse } from './site-verification.mjs';

const TOKEN = 'abc123DEF456';
const ENV = { GOOGLE_SITE_VERIFICATION: TOKEN };

describe('Search Console verification file', () => {
  it('serves the file Google asks for, with the line it looks for', async () => {
    const response = siteVerificationResponse(`/google${TOKEN}.html`, ENV)!;
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(`google-site-verification: google${TOKEN}.html`);
  });

  it('stays invisible until a token is configured, so no stray route exists', () => {
    expect(siteVerificationResponse(`/google${TOKEN}.html`, {})).toBeUndefined();
  });

  it('answers only its own path, leaving every other request to the game', () => {
    expect(siteVerificationResponse('/googleother.html', ENV)).toBeUndefined();
    expect(siteVerificationResponse('/', ENV)).toBeUndefined();
  });

  it('refuses a token that could smuggle a path into the route', () => {
    expect(siteVerificationResponse('/google../../etc.html', { GOOGLE_SITE_VERIFICATION: '../../etc' })).toBeUndefined();
  });
});
