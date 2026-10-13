import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/recover/route';
import { recoveryPath } from '../recoveryPath';
import { postSessionRecovery } from '../sessionSync';

const fetchMock = vi.fn();
const pair = { access_token: 'synthetic-at', refresh_token: 'synthetic-rt' };
function request({ origin = 'https://app.test', body = {}, cookie = 'mk_sb_rt=synthetic-old' } = {}) {
  return new NextRequest('https://app.test/api/auth/recover', { method: 'POST',
    headers: { origin, 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('SUPABASE_URL', 'https://auth.test'); vi.stubEnv('SUPABASE_ANON_KEY', 'public-key');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('returns only the validated rotated pair and writes matching secure cookies', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...pair, user: { id: 'synthetic-user' }, provider_token: 'exclude' })));
  const response = await POST(request());
  expect(await response.json()).toEqual({ ok: true, session: pair });
  expect(response.cookies.get('mk_sb_rt')).toMatchObject({ value: pair.refresh_token, httpOnly: true, secure: true, sameSite: 'lax' });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each([[400, 'refresh_token_not_found', 401], [400, 'refresh_token_already_used', 401],
  [429, 'unexpected', 429], [503, 'unexpected', 503], [400, 'unknown', 503]])(
  'preserves cookies and bounds exchanges on upstream %s/%s', async (status, code, expected) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code }), { status }));
    const response = await POST(request());
    expect(response.status).toBe(expected);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
it('keeps network failures recoverable', async () => {
  fetchMock.mockRejectedValue(new TypeError('offline'));
  expect((await POST(request())).status).toBe(503);
});
it('never exposes an incoming cookie without a successful Auth exchange', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(pair)));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(await response.json()).toEqual({ ok: false });
});
it('rejects cross-origin recovery without contacting Auth', async () => {
  expect((await POST(request({ origin: 'https://evil.test' }))).status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('rejects missing refresh credentials without contacting Auth', async () => {
  const response = await POST(request({ cookie: '' }));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ ok: false, reason: 'missing_session' });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('distinguishes an absent cookie session from a rejected refresh token', async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify({ ok: false, reason: 'missing_session' }), { status: 401 }));
  expect(await postSessionRecovery(transport)).toEqual({ ok: false, status: 401, missing: true });
  expect(transport).toHaveBeenCalledOnce();
});
it('uses the bounded same-origin transport for cookie recovery', async () => {
  fetchMock.mockRejectedValue(new TypeError('offline'));
  expect(await postSessionRecovery(fetchMock)).toEqual({ ok: false, status: 503 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', body: '{}' });
});
it.each(['https://evil.test', '//evil.test', '/auth/recover', '/login', '/api/auth/sync', '/items/../auth/recover', '/en/../login'])('rejects unsafe recovery destination %s', next => {
  expect(recoveryPath(next, 'en')).toBe('/en');
});
it.each(['/', '/en', '/history', '/en/items', '/items/abc-123?tab=details'])('restores the protected destination %s', next => {
  expect(recoveryPath(next, 'ru')).toBe(next);
});
