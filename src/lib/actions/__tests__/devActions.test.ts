import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));

vi.mock('@/lib/supabase/rlsServerClient', () => ({ getRlsClientAndUserId: mocks.getClient }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { resetAndSeedDemoData, seedDemoData, simulateTrip, simulateTripRange, wipeAllData } from '../devActions';

const actions: Array<[string, () => Promise<unknown>]> = [
  ['seedDemoData', () => seedDemoData()],
  ['simulateTrip', () => simulateTrip()],
  ['simulateTripRange', () => simulateTripRange('week')],
  ['resetAndSeedDemoData', () => resetAndSeedDemoData()],
  ['wipeAllData', () => wipeAllData()],
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getClient.mockRejectedValue(new Error('reached the user-scoped client'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dev server actions', () => {
  // A direct POST can reach these exports whenever the bundler keeps them in
  // the action manifest; hiding DevToolsPanel does not stop that.
  it.each(actions)('refuses %s in production before reading the session or data', async (_, run) => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(run()).rejects.toThrow('Dev actions are disabled outside development');
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it('refuses outside development even when NODE_ENV is not production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    await expect(wipeAllData()).rejects.toThrow('Dev actions are disabled outside development');
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it.each(actions)('lets %s reach the user-scoped client in development', async (_, run) => {
    vi.stubEnv('NODE_ENV', 'development');
    await expect(run()).rejects.toThrow('reached the user-scoped client');
    expect(mocks.getClient).toHaveBeenCalledOnce();
  });
});
