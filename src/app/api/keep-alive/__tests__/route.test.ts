import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), from: vi.fn(), insert: vi.fn(), remove: vi.fn(), lt: vi.fn(),
}));
vi.mock('@/lib/supabase/adminClient', () => ({ createAdminClient: mocks.admin }));

import { GET } from '../route';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
  mocks.admin.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ insert: mocks.insert, delete: mocks.remove });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.remove.mockReturnValue({ lt: mocks.lt });
  mocks.lt.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('server keep-alive', () => {
  it('uses the admin client for both ping insertion and retention cleanup', async () => {
    const response = await GET(new Request('https://example.test/api/keep-alive', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }));
    expect(response.status).toBe(200);
    expect(mocks.admin).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenNthCalledWith(1, 'keep_alive_pings');
    expect(mocks.from).toHaveBeenNthCalledWith(2, 'keep_alive_pings');
    expect(mocks.insert).toHaveBeenCalledWith({ pinged_at: '2026-10-08T10:00:00.000Z' });
    expect(mocks.lt).toHaveBeenCalledWith('pinged_at', '2026-09-08T10:00:00.000Z');
  });

  it('rejects ordinary callers before accessing the database', async () => {
    const response = await GET(new Request('https://example.test/api/keep-alive'));
    expect(response.status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(['Bearer test-cron-secreT', 'Bearer test-cron-secre', 'Bearer test-cron-secret-extra', 'bearer test-cron-secret', 'test-cron-secret'])(
    'rejects the near-miss header %j', async authorization => {
      const response = await GET(new Request('https://example.test/api/keep-alive', { headers: { authorization } }));
      expect(response.status).toBe(401);
      expect(mocks.admin).not.toHaveBeenCalled();
    });

  // `Bearer ${undefined}` used to be the expected header when the secret was absent.
  it.each([
    ['missing', undefined, 'Bearer undefined'],
    ['empty', '', 'Bearer '],
    ['blank', '   ', 'Bearer    '],
  ])('fails closed when CRON_SECRET is %s', async (_, secret, authorization) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    if (secret === undefined) delete process.env.CRON_SECRET;
    else vi.stubEnv('CRON_SECRET', secret);
    const response = await GET(new Request('https://example.test/api/keep-alive', { headers: { authorization } }));
    expect(response.status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[keep-alive] CRON_SECRET is not configured; refusing request');
  });
});
