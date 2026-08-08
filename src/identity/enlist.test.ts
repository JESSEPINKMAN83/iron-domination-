import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Fresh module per test: the enlistment is cached in memory, as render paths read it. */
const loadEnlist = () => import('./enlist');

const STORAGE_KEY = 'iron-dominion.enlisted.v1';

function stubBrowser(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  return store;
}

function stubFetch(response: { ok?: boolean; status?: number; body?: unknown }): { body: any }[] {
  const calls: { body: any }[] = [];
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) });
    return Promise.resolve({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.body ?? {}),
    } as Response);
  });
  return calls;
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('enlisting a commander', () => {
  it('sends the name and email and keeps the member it gets back', async () => {
    const { enlist } = await loadEnlist();
    stubBrowser();
    const calls = stubFetch({ body: { ok: true, memberId: 'member-1', ticket: 'signed' } });

    const outcome = await enlist({ name: '  Iron Fox ', email: ' Iron.Fox@Example.com ', releaseUpdates: true });

    expect(calls[0]!.body).toMatchObject({ kind: 'enlist', name: 'Iron Fox', email: 'iron.fox@example.com', releaseUpdates: true });
    expect(outcome).toEqual({ status: 'enlisted', commander: { memberId: 'member-1', ticket: 'signed', name: 'Iron Fox' } });
  });

  it('remembers the enlistment so multiplayer is one tap on the next visit', async () => {
    const { enlist } = await loadEnlist();
    const store = stubBrowser();
    stubFetch({ body: { memberId: 'member-1', ticket: 'signed' } });

    await enlist({ name: 'Iron Fox', email: 'fox@example.com' });

    expect(JSON.parse(store.get(STORAGE_KEY)!)).toEqual({ memberId: 'member-1', ticket: 'signed', name: 'Iron Fox' });
  });

  it('never sends a password, because the form has nowhere to type one', async () => {
    const { enlist } = await loadEnlist();
    stubBrowser();
    const calls = stubFetch({ body: { memberId: 'member-1', ticket: 'signed' } });
    await enlist({ name: 'Iron Fox', email: 'fox@example.com' });
    expect(Object.keys(calls[0]!.body)).toEqual(['kind', 'name', 'email', 'releaseUpdates', 'source']);
  });

  it('reports a rejected email without claiming the player is enlisted', async () => {
    const { enlist } = await loadEnlist();
    const store = stubBrowser();
    stubFetch({ ok: false, status: 400 });

    const outcome = await enlist({ name: 'Iron Fox', email: 'fox@example.com' });

    expect(outcome.status).toBe('error');
    expect(store.has(STORAGE_KEY)).toBe(false);
  });

  it('survives a server that answers without a member, rather than storing a broken identity', async () => {
    const { enlist } = await loadEnlist();
    stubBrowser();
    stubFetch({ body: { ok: true } });
    await expect(enlist({ name: 'Iron Fox', email: 'fox@example.com' })).resolves.toMatchObject({ status: 'error' });
  });

  it('asks for the missing field instead of calling the server with half a form', async () => {
    const { enlist } = await loadEnlist();
    stubBrowser();
    const calls = stubFetch({ body: {} });
    await expect(enlist({ name: '', email: 'fox@example.com' })).resolves.toMatchObject({ status: 'error' });
    expect(calls).toHaveLength(0);
  });
});

describe('reading a stored enlistment', () => {
  it('ignores a stored value that is not a usable member', async () => {
    const { enlistedCommander } = await loadEnlist();
    const store = stubBrowser();
    store.set(STORAGE_KEY, JSON.stringify({ name: 'Iron Fox' }));
    expect(enlistedCommander()).toBeUndefined();
  });

  it('reads back what it stored', async () => {
    const { enlistedCommander, rememberEnlistment } = await loadEnlist();
    stubBrowser();
    rememberEnlistment({ memberId: 'member-2', name: 'Iron Fox', ticket: 'signed' });
    expect(enlistedCommander()).toEqual({ memberId: 'member-2', name: 'Iron Fox', ticket: 'signed' });
  });

  it('falls back to a generic call sign rather than showing an empty name', async () => {
    const { parseEnlistment } = await loadEnlist();
    expect(parseEnlistment({ memberId: 'member-3', ticket: 'signed' }, '   ')?.name).toBe('Commander');
  });
});
