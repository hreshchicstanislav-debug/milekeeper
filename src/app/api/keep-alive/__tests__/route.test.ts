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
});
