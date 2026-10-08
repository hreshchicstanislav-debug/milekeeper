import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRedirect, BrowserSession } from '../browserSession';
const original = { access_token: 'at-a', refresh_token: 'rt-a' };
const rotated = { access_token: 'at-b', refresh_token: 'rt-b' };
let current: typeof original | null;
const auth = { getSession: vi.fn(), setSession: vi.fn(), signOut: vi.fn() };
const sync = vi.fn();
const clear = vi.fn();
let manager: BrowserSession;
beforeEach(() => {
  vi.resetAllMocks();
  current = original;
  auth.getSession.mockImplementation(async () => ({ data: { session: current }, error: null }));
  auth.setSession.mockImplementation(async tokens => { current = tokens; return { data: { session: tokens }, error: null }; });
  auth.signOut.mockImplementation(async () => { current = null; return { error: null }; });
  sync.mockResolvedValue({ ok: true, session: rotated });
  clear.mockResolvedValue(true);
  manager = new BrowserSession(auth, sync, clear);
});

describe('browser/server session synchronization', () => {
  it('adopts canonical rotation before permitting navigation, then deduplicates SDK events', async () => {
    const seen: string[] = [];
    manager.subscribe(state => seen.push(state.phase));
    expect(await manager.synchronize()).toBe(true);
    expect(current).toEqual(rotated);
    expect(authRedirect(manager.state, '/login')).toBe('/');
    expect(await manager.synchronize()).toBe(true);
    expect(sync).toHaveBeenCalledOnce();
    expect(seen).toContain('syncing');
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it.each([401, 429, 503])('keeps browser session and blocks redirects after sync HTTP %s', async status => {
    sync.mockResolvedValue({ ok: false, status });
    expect(await manager.synchronize()).toBe(false);
    for (const path of ['/login', '/', '/auth/callback']) expect(authRedirect(manager.state, path)).toBeNull();
    expect(current).toEqual(original);
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    // Repeated SIGNED_IN events do not retry a failed token forever.
    for (let i = 0; i < 5; i++) await manager.synchronize();
    expect(sync).toHaveBeenCalledOnce();
    sync.mockResolvedValue({ ok: true, session: rotated });
    expect(await manager.synchronize(true)).toBe(true);
    expect(sync).toHaveBeenCalledTimes(2);
  });
  it('deduplicates simultaneous callback and gate operations', async () => {
    const results = await Promise.all([manager.synchronize(), manager.synchronize(), manager.synchronize(true)]);
    expect(results).toEqual([true, true, true]);
    expect(sync).toHaveBeenCalledOnce();
  });
  it('retries failed browser adoption without rotating the old refresh token again', async () => {
    auth.setSession.mockResolvedValueOnce({ data: { session: null }, error: { status: 503 } });
    expect(await manager.synchronize()).toBe(false);
    expect(authRedirect(manager.state, '/login')).toBeNull();
    expect(await manager.synchronize(true)).toBe(true);
    expect(sync).toHaveBeenCalledOnce();
    expect(auth.setSession).toHaveBeenNthCalledWith(2, rotated);
  });
  it('does not clear cookies just because browser storage has no session', async () => {
    current = null;
    expect(await manager.synchronize()).toBe(false);
    expect(authRedirect(manager.state, '/')).toBe('/login');
    expect(authRedirect(manager.state, '/login')).toBeNull();
    expect(clear).not.toHaveBeenCalled();
  });
  it('treats getSession failure as unknown validity, not signed out', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: { status: 429 } });
    await manager.synchronize();
    expect(manager.state.phase).toBe('error');
    expect(authRedirect(manager.state, '/')).toBeNull();
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('coordinated logout', () => {
  it('requires both Supabase and server-cookie success', async () => {
    expect(await manager.logout()).toBe(true);
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(current).toBeNull();
    expect(authRedirect(manager.state, '/')).toBe('/login');
    expect(authRedirect(manager.state, '/login')).toBeNull();
    await manager.signedOut(); // delayed SDK event after the HTTP response
    expect(clear).toHaveBeenCalledOnce();
  });
  it('does not delete cookies or navigate when Supabase signOut fails', async () => {
    auth.signOut.mockResolvedValueOnce({ error: { status: 503 } });
    expect(await manager.logout()).toBe(false);
    expect(current).toEqual(original);
    expect(clear).not.toHaveBeenCalled();
    expect(authRedirect(manager.state, '/')).toBeNull();
    expect(await manager.synchronize()).toBe(false);
    expect(await manager.logout()).toBe(true);
  });
  it('reports and allows retry of partial logout without sync recreating cookies', async () => {
    clear.mockResolvedValueOnce(false);
    expect(await manager.logout()).toBe(false);
    expect(current).toBeNull();
    expect(authRedirect(manager.state, '/')).toBeNull();
    expect(await manager.signedOut()).toBe(false);
    expect(await manager.synchronize()).toBe(false);
    expect(sync).not.toHaveBeenCalled();
    expect(await manager.logout()).toBe(true);
    expect(clear).toHaveBeenCalledTimes(2);
  });
  it('serializes logout behind an in-flight sync so cookies cannot reappear after clearing', async () => {
    let release!: (value: { ok: true; session: typeof rotated }) => void;
    sync.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const syncing = manager.synchronize();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce());
    const loggingOut = manager.logout();
    expect(manager.state.phase).toBe('logging-out');
    expect(clear).not.toHaveBeenCalled();
    release({ ok: true, session: rotated });
    expect(await syncing).toBe(false);
    expect(await loggingOut).toBe(true);
    expect(current).toBeNull();
    expect(manager.state.phase).toBe('anon');
  });
  it('handles externally expired/signed-out sessions without revoking twice', async () => {
    current = null;
    expect(await manager.signedOut()).toBe(true);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
    expect(manager.state.phase).toBe('anon');
  });
  it('deduplicates double click logout', async () => {
    expect(await Promise.all([manager.logout(), manager.logout()])).toEqual([true, true]);
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });
});

it('does not bounce token rotations between two tabs receiving SDK broadcasts', async () => {
  let marker: string | null = null;
  let tabQueue: Promise<unknown> = Promise.resolve();
  const tabs = {
    exclusive(work: () => Promise<boolean>) { const task = tabQueue.then(work); tabQueue = task; return task; },
    async isConfirmed(tokens: typeof original) { return marker === JSON.stringify(tokens); },
    async confirm(tokens: typeof original | null) { marker = tokens ? JSON.stringify(tokens) : null; },
  };
  let generation = 0;
  sync.mockImplementation(async () => ({ ok: true, session: { access_token: `at-${++generation}`, refresh_token: `rt-${generation}` } }));
  const first = new BrowserSession(auth, sync, clear, tabs);
  const second = new BrowserSession(auth, sync, clear, tabs);
  await first.synchronize();
  await second.synchronize(); // every newly opened tab performs its own initial verification
  expect(sync).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 5; i++) await Promise.all([first.synchronize(), second.synchronize()]);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(first.state.phase).toBe('authed');
  expect(second.state.phase).toBe('authed');
});
it('fails visibly without broadcasting when cross-tab marker storage is unavailable', async () => {
  const tabs = { exclusive: (work: () => Promise<boolean>) => work(), isConfirmed: async () => false,
    confirm: vi.fn().mockRejectedValue(new Error('Storage disabled')) };
  manager = new BrowserSession(auth, sync, clear, tabs);
  expect(await manager.synchronize()).toBe(false);
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(authRedirect(manager.state, '/login')).toBeNull();
});

it('does not overwrite a newer browser login with an old in-flight sync response', async () => {
  const newer = { access_token: 'other-user-at', refresh_token: 'other-user-rt' };
  sync.mockImplementationOnce(async () => { current = newer; return { ok: true, session: rotated }; });
  expect(await manager.synchronize()).toBe(false);
  expect(current).toEqual(newer);
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(authRedirect(manager.state, '/login')).toBeNull();
  sync.mockResolvedValue({ ok: true, session: newer });
  expect(await manager.synchronize(true)).toBe(true);
});
it('does not clear a newer login in response to a stale queued SIGNED_OUT event', async () => {
  expect(await manager.signedOut()).toBe(false); // SDK now has a newer session
  await vi.waitFor(() => expect(manager.state.phase).toBe('authed'));
  expect(clear).not.toHaveBeenCalled();
  expect(current).toEqual(rotated);
});

it('retries a genuinely new refresh pair even if the access JWT has not changed', async () => {
  sync.mockResolvedValueOnce({ ok: false, status: 503 });
  await manager.synchronize();
  current = { ...original, refresh_token: 'fresh-refresh-same-jwt' };
  expect(await manager.synchronize()).toBe(true);
  expect(sync).toHaveBeenCalledTimes(2);
});

it('does not declare logout successful if signOut reports success but browser session remains active', async () => {
  auth.signOut.mockResolvedValue({ error: null });
  expect(await manager.logout()).toBe(false);
  expect(clear).not.toHaveBeenCalled();
  expect(authRedirect(manager.state, '/')).toBeNull();
  expect(manager.state.message).toContain('осталась активной');
});
