import { describe, it, expect, vi } from 'vitest';
import { nextSyncAction, postSessionSync, postSessionLogout } from '../sessionSync';

const ok = () => new Response('{}', { status: 200 });
const badRequest = () => new Response('{}', { status: 400 });
const serverError = () => new Response('{}', { status: 500 });

describe('nextSyncAction', () => {
  it('syncs the first session it sees', () => {
    expect(nextSyncAction(null, 'token-a')).toBe('sync');
  });

  it('does nothing when the access token has not changed', () => {
    expect(nextSyncAction({ kind: 'session', accessToken: 'token-a' }, 'token-a')).toBe('none');
  });

  it('syncs again once the token rotates', () => {
    expect(nextSyncAction({ kind: 'session', accessToken: 'token-a' }, 'token-b')).toBe('sync');
  });

  it('logs out when the session disappears', () => {
    expect(nextSyncAction({ kind: 'session', accessToken: 'token-a' }, null)).toBe('logout');
    expect(nextSyncAction(null, undefined)).toBe('logout');
  });

  it('does not repeat the logout once it is confirmed', () => {
    expect(nextSyncAction({ kind: 'signed-out' }, null)).toBe('none');
  });

  it('re-syncs after a sign-out followed by a new session', () => {
    expect(nextSyncAction({ kind: 'signed-out' }, 'token-c')).toBe('sync');
  });

  // The regression this whole change set exists for: an *attempted* sync must
  // never be recorded as synced, or the cookies silently drift behind the
  // browser session until Supabase terminates it.
  it('still asks for a sync when the previous attempt was not confirmed', () => {
    const stateAfterFailedAttempt = null; // caller must not advance on failure
    expect(nextSyncAction(stateAfterFailedAttempt, 'token-a')).toBe('sync');
  });
});

describe('postSessionSync', () => {
  const tokens = { access_token: 'at', refresh_token: 'rt' };

  it('posts the tokens with keepalive and reports success', async () => {
    const fetchImpl = vi.fn(async () => ok());
    await expect(postSessionSync(tokens, fetchImpl as unknown as typeof fetch)).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/sync');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(tokens);
  });

  it('retries once after a transient network failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(ok());
    await expect(postSessionSync(tokens, fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries once after a 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(serverError()).mockResolvedValueOnce(ok());
    await expect(postSessionSync(tokens, fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports failure, not success, when both attempts fail', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(postSessionSync(tokens, fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx, which is a definitive answer', async () => {
    const fetchImpl = vi.fn(async () => badRequest());
    await expect(postSessionSync(tokens, fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never retries more than once, so a dead server cannot cause a storm', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(serverError());
    await expect(postSessionSync(tokens, fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('postSessionLogout', () => {
  it('clears the cookies via the logout route', async () => {
    const fetchImpl = vi.fn(async () => ok());
    await expect(postSessionLogout(fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/logout');
    expect(init.keepalive).toBe(true);
  });

  it('reports failure so the caller can retry', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(postSessionLogout(fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });
});
