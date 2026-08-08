import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - plain ESM worker module
import { clearFormSummaryCache, handleWixSubmission } from './wix-backoffice.mjs';

const ENV = {
  WIX_API_KEY: 'api-key',
  WIX_SITE_ID: 'site-1',
  WIX_CMS_ENDPOINT: 'https://example.wixsite.com/_functions/ironDominionSubmission',
  IRON_DOMINION_INGEST_SECRET: 'shared-secret',
};

const ENLIST = { kind: 'enlist', name: 'Iron Fox', email: 'Iron.Fox@Example.com', releaseUpdates: true };

function post(body: unknown): Request {
  return new Request('https://worker.test/api/wix-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface Call {
  url: string;
  body: any;
}

/** Replies the way Wix does, so only the interesting failure is scripted per test. */
function stubWix(options: { memberCreate?: { status: number; body: unknown }; existingMemberId?: string } = {}) {
  const calls: Call[] = [];
  const json = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);

  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.endsWith('/members/v1/members')) {
      const scripted = options.memberCreate ?? { status: 200, body: { member: { id: 'member-new' } } };
      return Promise.resolve(json(scripted.status, scripted.body));
    }
    if (url.endsWith('/members/v1/members/query')) {
      const members = options.existingMemberId ? [{ id: options.existingMemberId }] : [];
      return Promise.resolve(json(200, { members }));
    }
    if (url.includes('/forms/')) {
      return Promise.resolve(json(200, { formSummary: { fields: [
        { label: 'Name', target: 'name', type: 'string' },
        { label: 'Email', target: 'email', type: 'string' },
      ] } }));
    }
    return Promise.resolve(json(200, { ok: true }));
  });
  return calls;
}

async function expectedTicket(memberId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ENV.IRON_DOMINION_INGEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(memberId));
  return Buffer.from(new Uint8Array(signature)).toString('base64url');
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearFormSummaryCache();
});

describe('enlisting a player as a site member', () => {
  it('creates the member and hands back a ticket the relay can verify', async () => {
    const calls = stubWix();
    const response = await handleWixSubmission(post(ENLIST), ENV);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      memberId: 'member-new',
      ticket: await expectedTicket('member-new'),
    });

    const create = calls.find((call) => call.url.endsWith('/members/v1/members'))!;
    expect(create.body).toEqual({ member: { loginEmail: 'iron.fox@example.com', profile: { nickname: 'Iron Fox' } } });
  });

  it('reuses the member behind an email that already has one, so a second device is not an error', async () => {
    stubWix({
      memberCreate: { status: 409, body: { message: 'Already exists', details: { applicationError: { code: 'ALREADY_EXISTS' } } } },
      existingMemberId: 'member-existing',
    });

    const response = await handleWixSubmission(post(ENLIST), ENV);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ memberId: 'member-existing' });
  });

  it('fails loudly when Wix claims a member exists that no query can find', async () => {
    stubWix({ memberCreate: { status: 409, body: { message: 'Already exists' } } });
    const response = await handleWixSubmission(post(ENLIST), ENV);
    expect(response.status).toBe(502);
  });

  it('never sends a password to anyone, because none is ever collected', async () => {
    const calls = stubWix();
    await handleWixSubmission(post({ ...ENLIST, password: 'hunter2' }), ENV);
    expect(JSON.stringify(calls)).not.toContain('hunter2');
    expect(JSON.stringify(calls).toLowerCase()).not.toContain('password');
  });

  it('rejects an address that is not an email rather than creating a junk member', async () => {
    const calls = stubWix();
    const response = await handleWixSubmission(post({ ...ENLIST, email: 'not-an-email' }), ENV);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses to enlist without the shared secret, since the ticket would be unverifiable', async () => {
    stubWix();
    const { IRON_DOMINION_INGEST_SECRET: _omitted, ...noSecret } = ENV;
    const response = await handleWixSubmission(post(ENLIST), noSecret);
    expect(response.status).toBe(503);
  });

  it('records the enlistment in the same signup list as everyone else', async () => {
    const calls = stubWix();
    await handleWixSubmission(post(ENLIST), ENV);
    const cms = calls.find((call) => call.url === ENV.WIX_CMS_ENDPOINT)!;
    expect(cms.body).toMatchObject({ kind: 'signup', name: 'Iron Fox', email: 'iron.fox@example.com' });
  });

  it('creates the contact as well, so the member has someone to be in the CRM', async () => {
    const calls = stubWix();
    await handleWixSubmission(post(ENLIST), ENV);
    const contact = calls.find((call) => call.url.includes('/contacts/v4/contacts'))!;
    expect(contact.body.info.emails.items[0].email).toBe('iron.fox@example.com');
  });
});
