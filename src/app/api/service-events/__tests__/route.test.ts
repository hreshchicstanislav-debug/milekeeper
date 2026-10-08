import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthenticationRequiredError, AuthenticationUnavailableError } from '@/lib/auth/authFailure';
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/supabase/rlsServerClient', () => ({ getRlsClientAndUserId: mocks.auth }));
import { GET } from '../route';
beforeEach(() => { vi.resetAllMocks(); });
it.each([
  [new AuthenticationRequiredError(), 401],
  [new AuthenticationUnavailableError('rate-limit'), 429],
  [new AuthenticationUnavailableError('network'), 503],
  [new Error('database unavailable'), 500],
])('returns the correct status without changing the error envelope', async (error, status) => {
  mocks.auth.mockRejectedValue(error);
  const res = await GET(new NextRequest('https://milekeeper.test/api/service-events?itemId=item-a'));
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ ok: false, error: (error as Error).message });
});
it('keeps the success contract and user scope', async () => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [], error: null });
  mocks.auth.mockResolvedValue({ userId: 'user-a', supabase: { from: () => query } });
  const res = await GET(new NextRequest('https://milekeeper.test/api/service-events?itemId=item-a'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, events: [] });
  expect(query.eq).toHaveBeenCalledWith('user_id', 'user-a');
});
