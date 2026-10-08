import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as sync } from '../sync/route';
import { POST as logout } from '../logout/route';
import type { Session } from '@supabase/supabase-js';
import { BrowserSession } from '@/lib/auth/browserSession';
import { postSessionSync } from '@/lib/auth/sessionSync';

const jwt = (sid = 'session-a', user = 'user-a') => `e30.${Buffer.from(JSON.stringify({ session_id: sid, sub: user, exp: 9999999999 })).toString('base64url')}.signature`;
const tokens = { access_token: jwt(), refresh_token: 'rt-a' };
const rotated = { access_token: jwt(), refresh_token: 'rt-b' };
const fetchMock = vi.fn();
function request(path = 'sync', body: unknown = tokens, headers: Record<string, string> = {}) {
  return new NextRequest(`https://milekeeper.test/api/auth/${path}`, {
    method: 'POST', headers: { Origin: 'https://milekeeper.test', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function authRespond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}
function validRefresh(sid = 'session-a', user = 'user-a') {
  return authRespond(200, { ...rotated, access_token: jwt(sid, user), user: { id: user } });
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://auth.test');
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-public-key');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(authRespond(200, { id: 'user-a' })).mockResolvedValueOnce(validRefresh());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('validates both tokens, persists and returns the same rotated pair without caching', async () => {
  const res = await sync(request());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, session: rotated });
  expect(res.cookies.get('mk_sb_at')?.value).toBe(rotated.access_token);
  expect(res.cookies.get('mk_sb_rt')?.value).toBe('rt-b');
  expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  const cookie = res.cookies.get('mk_sb_at');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toBe('https://auth.test/auth/v1/user');
  expect(fetchMock.mock.calls[1][0]).toBe('https://auth.test/auth/v1/token?grant_type=refresh_token');
});

it('synchronizes a full SDK OAuth session through the real client serializer and strict route', async () => {
  let current: Session = {
    ...tokens, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999,
    provider_token: 'synthetic-google-token', provider_refresh_token: 'synthetic-google-refresh',
    user: { id: 'user-a', app_metadata: {}, user_metadata: {}, aud: 'authenticated',
      created_at: '2026-10-09T00:00:00Z' },
  };
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
    setSession: vi.fn(async (pair: { access_token: string; refresh_token: string }) => {
      current = { ...current, ...pair };
      return { data: { session: current }, error: null };
    }),
    signOut: vi.fn(),
  };
  let cookiePair: { access_token?: string; refresh_token?: string } | undefined;
  const transport = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async (_input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', 'https://milekeeper.test');
    headers.set('Sec-Fetch-Site', 'same-origin');
    const response = await sync(new NextRequest('https://milekeeper.test/api/auth/sync', {
      ...init, headers, signal: init?.signal ?? undefined,
    }));
    cookiePair = { access_token: response.cookies.get('mk_sb_at')?.value,
      refresh_token: response.cookies.get('mk_sb_rt')?.value };
    return response;
  });
  const manager = new BrowserSession(auth, pair => postSessionSync(pair, transport));
  // Callback and AuthGate share one flight; setSession still returns a full SDK Session.
  expect(await Promise.all([manager.synchronize(true), manager.synchronize()])).toEqual([true, true]);
  expect(transport).toHaveBeenCalledOnce();
  expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual(tokens);
  expect(fetchMock).toHaveBeenCalledTimes(2); // remote getUser then refresh
  expect(auth.setSession).toHaveBeenCalledOnce();
  expect(auth.setSession).toHaveBeenCalledWith(rotated);
  expect(cookiePair).toEqual(rotated);
  expect(current.access_token).toBe(rotated.access_token);
  expect(current.refresh_token).toBe(rotated.refresh_token);
  expect(manager.state.phase).toBe('authed');
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(await manager.synchronize()).toBe(true);
  expect(transport).toHaveBeenCalledOnce();
});

for (const [path, handler] of [['sync', sync], ['logout', logout]] as const) {
  describe(`${path} CSRF/input protection`, () => {
    it.each(['https://evil.test', 'null', 'https://milekeeper.test.evil.test', 'https://sub.milekeeper.test'])('rejects Origin %s without cookie writes', async origin => {
      const res = await handler(request(path, path === 'logout' ? {} : tokens, { Origin: origin }));
      expect(res.status).toBe(403);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it('rejects a missing Origin and ignores forwarded host spoofing', async () => {
      const req = request(path, {}, { 'X-Forwarded-Host': 'evil.test' });
      req.headers.delete('origin');
      expect((await handler(req)).status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it('rejects cross-site Fetch Metadata even with a forged same Origin', async () => {
      expect((await handler(request(path, {}, { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);
    });
    it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', ''])('rejects content type %s', async type => {
      const res = await handler(request(path, {}, { 'Content-Type': type }));
      expect(res.status).toBe(415);
      expect(res.headers.get('set-cookie')).toBeNull();
    });
    it.each([null, [], 123, 'text'])('rejects non-object JSON %s', async body => {
      expect((await handler(request(path, body))).status).toBe(400);
    });
    it('rejects malformed JSON', async () => {
      const req = new NextRequest(`https://milekeeper.test/api/auth/${path}`, {
        method: 'POST', headers: { Origin: 'https://milekeeper.test', 'Content-Type': 'application/json' }, body: '{',
      });
      expect((await handler(req)).status).toBe(400);
    });
    it('bounds the request body', async () => {
      const res = await handler(request(path, { data: 'a'.repeat(32769) }));
      expect(res.status).toBe(413);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
}

it.each([{ access_token: '', refresh_token: 'rt' }, { access_token: 'a', refresh_token: 1 },
  { ...tokens, extra: true }, { access_token: 'a'.repeat(16385), refresh_token: 'rt' }])('rejects malformed token fields', async body => {
  expect((await sync(request('sync', body))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('rejects an invalid/expired access token before touching refresh', async () => {
  fetchMock.mockReset().mockResolvedValue(authRespond(401, { code: 'bad_jwt' }));
  const res = await sync(request());
  expect(res.status).toBe(401);
  expect(res.headers.get('set-cookie')).toBeNull();
  expect(fetchMock).toHaveBeenCalledOnce();
});
it('rejects an invalid refresh token even when access token is valid', async () => {
  fetchMock.mockReset().mockResolvedValueOnce(authRespond(200, { id: 'user-a' }))
    .mockResolvedValueOnce(authRespond(400, { code: 'refresh_token_not_found' }));
  const res = await sync(request());
  expect(res.status).toBe(401);
  expect(res.headers.get('set-cookie')).toBeNull();
});
it.each([['session-b', 'user-a'], ['session-b', 'user-b']])('rejects mismatched session/user %s/%s', async (sid, user) => {
  fetchMock.mockReset().mockResolvedValueOnce(authRespond(200, { id: 'user-a' })).mockResolvedValueOnce(validRefresh(sid, user));
  const res = await sync(request());
  expect(res.status).toBe(401);
  expect(res.headers.get('set-cookie')).toBeNull();
});
it.each([429, 503, 500])('preserves cookies on Auth HTTP %s', async status => {
  fetchMock.mockReset().mockResolvedValue(authRespond(status, { code: 'session_expired' }));
  const res = await sync(request());
  expect(res.status).toBe(status === 429 ? 429 : 503);
  expect(res.headers.get('set-cookie')).toBeNull();
});
it('preserves cookies on network failure', async () => {
  fetchMock.mockReset().mockRejectedValue(new TypeError('offline'));
  const res = await sync(request());
  expect(res.status).toBe(503);
  expect(res.headers.get('set-cookie')).toBeNull();
});
it.each([429, 503])('preserves cookies on refresh HTTP %s', async status => {
  fetchMock.mockReset().mockResolvedValueOnce(authRespond(200, { id: 'user-a' })).mockResolvedValueOnce(authRespond(status, {}));
  const res = await sync(request());
  expect(res.status).toBe(status);
  expect(res.headers.get('set-cookie')).toBeNull();
});
it('clears both cookies only after a valid logout request', async () => {
  const res = await logout(request('logout', {}));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.cookies.get('mk_sb_at')).toMatchObject({ value: '', maxAge: 0 });
  expect(res.cookies.get('mk_sb_rt')).toMatchObject({ value: '', maxAge: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('rejects unexpected logout fields', async () => {
  expect((await logout(request('logout', tokens))).status).toBe(400);
});

it('does not treat an unknown 401/configuration error as invalid user credentials', async () => {
  fetchMock.mockReset().mockResolvedValue(authRespond(401, { message: 'Invalid API key' }));
  const res = await sync(request());
  expect(res.status).toBe(503);
  expect(res.headers.get('set-cookie')).toBeNull();
});
it('maps Supabase JWT rejection to 401 even when its upstream status is 403', async () => {
  fetchMock.mockReset().mockResolvedValue(authRespond(403, { code: 'bad_jwt' }));
  expect((await sync(request())).status).toBe(401);
});
it('keeps a malformed successful refresh response non-destructive', async () => {
  fetchMock.mockReset().mockResolvedValueOnce(authRespond(200, { id: 'user-a' }))
    .mockResolvedValueOnce(authRespond(200, rotated));
  const res = await sync(request());
  expect(res.status).toBe(503);
  expect(res.headers.get('set-cookie')).toBeNull();
});
it('does not trust a locally decoded JWT without remote access-token validation', async () => {
  fetchMock.mockReset().mockResolvedValue(authRespond(401, { code: 'bad_jwt' }));
  const res = await sync(request('sync', { access_token: jwt('attacker-sid', 'attacker-user'), refresh_token: 'rt' }));
  expect(res.status).toBe(401);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(res.headers.get('set-cookie')).toBeNull();
});

it('accepts the actual loopback authority even though NextURL normalizes its hostname', async () => {
  const req = new NextRequest('http://127.0.0.1:3102/api/auth/logout', {
    method: 'POST', headers: { Host: '127.0.0.1:3102', Origin: 'http://127.0.0.1:3102', 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(req.nextUrl.hostname).toBe('localhost');
  expect((await logout(req)).status).toBe(200);
});
it('checks the exact browser authority including port and scheme', async () => {
  const req = new NextRequest('https://milekeeper.test/api/auth/logout', {
    method: 'POST', headers: { Host: 'milekeeper.test', Origin: 'http://milekeeper.test', 'Content-Type': 'application/json' }, body: '{}',
  });
  expect((await logout(req)).status).toBe(403);
});
