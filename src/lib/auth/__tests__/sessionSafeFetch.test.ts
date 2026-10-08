import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { sessionSafeFetch, SDK_RATE_LIMIT_MESSAGE } from '../sessionSafeFetch';
import { classifyAuthFailure } from '../authFailure';
const url = 'https://auth.test';
const refreshUrl = `${url}/auth/v1/token?grant_type=refresh_token`;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([429, 500, 408, 400, 401])('adapts non-definitive refresh HTTP %s to SDK retryable transport', async status => {
  const fetchImpl = vi.fn(async () => new Response('{}', { status }));
  const fetchSafe = sessionSafeFetch(url, fetchImpl);
  const first = await fetchSafe(refreshUrl, { method: 'POST' });
  expect(first.status).toBe(503);
  const second = await fetchSafe(refreshUrl, { method: 'POST' });
  expect(second.status).toBe(503);
  expect(fetchImpl).toHaveBeenCalledOnce();
});
it('respects Retry-After without flooding Supabase during SDK backoff', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
  const safe = sessionSafeFetch(url, fetchImpl);
  await safe(refreshUrl, { method: 'POST' });
  vi.setSystemTime(1030000);
  await safe(refreshUrl, { method: 'POST' });
  expect(fetchImpl).toHaveBeenCalledOnce();
  vi.setSystemTime(1120000);
  await safe(refreshUrl, { method: 'POST' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('passes genuine invalid refresh credentials through to the SDK', async () => {
  const response = new Response(JSON.stringify({ code: 'refresh_token_not_found' }), { status: 400 });
  expect(await sessionSafeFetch(url, vi.fn(async () => response))(refreshUrl, { method: 'POST' })).toBe(response);
});
it.each(['/auth/v1/logout', '/auth/v1/user', '/rest/v1/service_events', '/auth/v1/token?grant_type=pkce'])('does not rewrite other SDK requests %s', async path => {
  const response = new Response('{}', { status: 429 });
  expect(await sessionSafeFetch(url, vi.fn(async () => response))(`${url}${path}`, { method: 'POST' })).toBe(response);
});

// Real auth-js storage/refresh behavior, not a mock of its sign-out decision.
it.each(['429', '500', 'unknown-400', 'network', 'malformed-200'])('real SDK retains session storage for %s', async scenario => {
  vi.useFakeTimers();
  const payload = Buffer.from(JSON.stringify({ exp: 1, sub: 'test-user', session_id: 'test-session' })).toString('base64url');
  const expired = { access_token: `e30.${payload}.c2ln`, refresh_token: 'test-refresh',
    expires_at: 1, expires_in: 1, token_type: 'bearer', user: { id: 'test-user' } };
  const values = new Map([['test-auth', JSON.stringify(expired)]]);
  const fetchImpl = vi.fn(async () => {
    if (scenario === 'network') throw new TypeError('offline');
    if (scenario === 'malformed-200') return new Response('{}');
    return new Response(JSON.stringify({ code: 'unexpected_failure' }), { status: scenario === 'unknown-400' ? 400 : Number(scenario) });
  });
  const client = createClient(url, 'test-public-key', {
    auth: { storageKey: 'test-auth', autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } },
    global: { fetch: sessionSafeFetch(url, fetchImpl) },
  });
  await client.auth.initialize();
  const pending = client.auth.getSession();
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.error?.name).toBe('AuthRetryableFetchError');
  expect(values.get('test-auth')).toBe(JSON.stringify(expired));
  expect(fetchImpl).toHaveBeenCalledOnce(); // SDK retries are served by the local cooldown
  if (scenario === '429') {
    expect(result.error?.message).toBe(SDK_RATE_LIMIT_MESSAGE);
    expect(classifyAuthFailure(result.error!)).toBe('rate-limit');
  }
  await client.auth.stopAutoRefresh();
});
it('real SDK still removes a definitively rejected refresh token', async () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1, sub: 'test-user' })).toString('base64url');
  const values = new Map([['test-auth-invalid', JSON.stringify({ access_token: `e30.${payload}.c2ln`, refresh_token: 'dead-refresh',
    expires_at: 1, expires_in: 1, token_type: 'bearer', user: { id: 'test-user' } })]]);
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'refresh_token_not_found' }), {
    status: 400, headers: { 'x-supabase-api-version': '2024-01-01' },
  }));
  const client = createClient(url, 'test-public-key', {
    auth: { storageKey: 'test-auth-invalid', autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } },
    global: { fetch: sessionSafeFetch(url, fetchImpl) },
  });
  await client.auth.initialize();
  expect((await client.auth.getSession()).error?.code).toBe('refresh_token_not_found');
  expect(values.has('test-auth-invalid')).toBe(false);
  await client.auth.stopAutoRefresh();
});

it('real SDK persists a successful refresh through the adapter', async () => {
  const jwt = (exp: number) => `e30.${Buffer.from(JSON.stringify({ exp, sub: 'test-user' })).toString('base64url')}.c2ln`;
  const values = new Map([['test-auth-success', JSON.stringify({ access_token: jwt(1), refresh_token: 'old-refresh',
    expires_at: 1, expires_in: 1, token_type: 'bearer', user: { id: 'test-user' } })]]);
  const fresh = { access_token: jwt(Math.floor(Date.now() / 1000) + 3600), refresh_token: 'rotated-refresh',
    expires_in: 3600, token_type: 'bearer', user: { id: 'test-user' } };
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fresh)));
  const client = createClient(url, 'test-public-key', {
    auth: { storageKey: 'test-auth-success', autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } },
    global: { fetch: sessionSafeFetch(url, fetchImpl) },
  });
  await client.auth.initialize();
  const result = await client.auth.getSession();
  expect(result.error).toBeNull();
  expect(result.data.session?.refresh_token).toBe('rotated-refresh');
  expect(JSON.parse(values.get('test-auth-success')!).refresh_token).toBe('rotated-refresh');
  expect(fetchImpl).toHaveBeenCalledOnce();
  await client.auth.stopAutoRefresh();
});
