import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthenticationRequiredError, AuthenticationUnavailableError } from '@/lib/auth/authFailure';
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/supabase/rlsServerClient', () => ({ getRlsClientAndUserId: mocks.auth }));
import { GET } from '../route';

const ITEM = '00000000-0000-4000-8000-000000000010';
const url = (query: string) => new NextRequest(`https://milekeeper.test/api/service-events?${query}`);

/** Chainable builder that records every filter; resolves with `result`. */
function fakeQuery(result: { data: unknown[] | null; error: unknown } = { data: [], error: null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const make = () => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'lt', 'order', 'limit']) {
      query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query; };
    }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  };
  return { calls, client: { from: (table: string) => { calls.push(['from', table]); return make(); } } };
}

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

it.each([
  [new AuthenticationRequiredError(), 401],
  [new AuthenticationUnavailableError('rate-limit'), 429],
  [new AuthenticationUnavailableError('network'), 503],
])('returns the auth status without changing the error envelope', async (error, status) => {
  mocks.auth.mockRejectedValue(error);
  const res = await GET(url(`itemId=${ITEM}`));
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ ok: false, error: error.message });
});

it('hides internal errors behind a generic, translatable message', async () => {
  mocks.auth.mockRejectedValue(new Error('database unavailable at 10.0.0.1'));
  const res = await GET(url(`itemId=${ITEM}`));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ ok: false, error: 'Не удалось загрузить историю. Попробуйте ещё раз.' });
});

it('does not leak SQL errors from the query', async () => {
  const { client } = fakeQuery({ data: null, error: { message: 'relation "service_events" column kind does not exist', code: '42703' } });
  mocks.auth.mockResolvedValue({ userId: 'user-a', supabase: client });
  const res = await GET(url(`itemId=${ITEM}`));
  expect(res.status).toBe(500);
  expect(JSON.stringify(await res.json())).not.toContain('kind does not exist');
});

it('returns the first page in the user scope with the strict order', async () => {
  const { calls, client } = fakeQuery();
  mocks.auth.mockResolvedValue({ userId: 'user-a', supabase: client });
  const res = await GET(url(`itemId=${ITEM}`));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, events: [], hasMore: false, previousReplacement: null });
  expect(calls).toContainEqual(['eq', 'user_id', 'user-a']);
  expect(calls).toContainEqual(['eq', 'service_item_id', ITEM]);
  expect(calls.filter(([m]) => m === 'order').map(([, column]) => column)).toEqual(['occurred_at', 'mileage_km', 'id']);
  // Ten rows are shown; one more tells whether an older page exists.
  expect(calls).toContainEqual(['limit', 11]);
});

it('pages from the cursor with exact values', async () => {
  const { calls, client } = fakeQuery();
  mocks.auth.mockResolvedValue({ userId: 'user-a', supabase: client });
  const at = '2026-07-01T09:00:00.123456+00:00';
  const id = '00000000-0000-4000-8000-000000000099';
  const res = await GET(url(`itemId=${ITEM}&limit=10&beforeAt=${encodeURIComponent(at)}&beforeKm=112000&beforeId=${id}`));
  expect(res.status).toBe(200);
  expect(calls).toContainEqual(['lt', 'occurred_at', at]);
  expect(calls).toContainEqual(['eq', 'occurred_at', at]);
  expect(calls).toContainEqual(['lt', 'mileage_km', 112000]);
  expect(calls).toContainEqual(['lt', 'id', id]);
});

it.each([
  ['itemId=', 'itemId is required'],
  ['itemId=item-a', 'itemId is invalid'],
  [`itemId=${ITEM}&limit=0`, 'limit must be between 1 and 50'],
  [`itemId=${ITEM}&limit=51`, 'limit must be between 1 and 50'],
  [`itemId=${ITEM}&beforeAt=2026-01-01T00:00:00Z`, 'cursor is invalid'],
  [`itemId=${ITEM}&beforeAt=x&beforeKm=1&beforeId=${ITEM}`, 'cursor is invalid'],
])('rejects invalid parameters (%s) before querying', async (query, error) => {
  const res = await GET(url(query));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, error });
  expect(mocks.auth).not.toHaveBeenCalled();
});
