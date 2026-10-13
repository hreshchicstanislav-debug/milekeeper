import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * React's real `cache()` memoizes per request scope: it reads the dispatcher
 * off `ReactSharedInternals.A` (AsyncLocalStorage-backed in Next's server
 * runtime) and falls back to a plain pass-through call when no scope is
 * active — which is what happens in a bare vitest process, so the production
 * dedupe cannot be observed here without emulating the scope.
 *
 * This mock stands in for exactly one request scope and is reset between
 * tests. It is not a re-implementation of React for its own sake: if anyone
 * unwraps `getRlsClientAndUserId` from `cache()`, this mock stops applying and
 * the dedupe tests below fail, which is the regression we care about.
 */
const hoisted = vi.hoisted(() => ({ resetters: [] as Array<() => void> }));

vi.mock('react', () => ({
  cache: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => {
    let entry: { value: TResult } | undefined;
    hoisted.resetters.push(() => {
      entry = undefined;
    });
    return (...args: TArgs): TResult => {
      if (!entry) {
        entry = { value: fn(...args) };
      }
      return entry.value;
    };
  },
}));

const cookieValues = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValues.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const setSession = vi.fn();
const getUser = vi.fn();
const createClient = vi.fn(() => ({ auth: { setSession, getUser } }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...(args as [])),
}));

const { getRlsClientAndUserId, requireCurrentUserId } = await import('../rlsServerClient');

function sessionResponse(overrides: { refresh_token?: string } = {}) {
  return {
    data: {
      user: { id: 'user-123' },
      session: {
        access_token: 'at-live',
        refresh_token: overrides.refresh_token ?? 'rt-live',
      },
    },
    error: null,
  };
}

beforeEach(() => {
  hoisted.resetters.forEach((reset) => reset());
  createClient.mockClear();
  setSession.mockReset();
  getUser.mockReset();
  cookieValues.clear();
  cookieValues.set('mk_sb_at', 'at-live');
  cookieValues.set('mk_sb_rt', 'rt-live');
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  getUser.mockResolvedValue(sessionResponse());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getRlsClientAndUserId — fresh session', () => {
  it('builds one client, validates the JWT once, and returns the user id', async () => {
    const { userId, supabase } = await getRlsClientAndUserId();

    expect(userId).toBe('user-123');
    expect(supabase).toBeDefined();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledWith('at-live');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('never exchanges the refresh token in a render or action', async () => {
    await getRlsClientAndUserId();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('creates the client with server-safe auth options', async () => {
    await getRlsClientAndUserId();
    const [, , options] = createClient.mock.calls[0] as unknown as [string, string, any];
    expect(options.global.headers.Authorization).toBe('Bearer at-live');
    expect(options.auth).toMatchObject({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
  });
});

describe('getRlsClientAndUserId — request-scoped dedupe', () => {
  it('serves four parallel data functions from one auth initialization', async () => {
    // This is the Home render: three phase-1 loaders plus the phase-2 events
    // query. Each used to build its own client, its own session and its own
    // refresh of the very same refresh token.
    const results = await Promise.all([
      getRlsClientAndUserId(),
      getRlsClientAndUserId(),
      getRlsClientAndUserId(),
      getRlsClientAndUserId(),
    ]);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.supabase)).size).toBe(1);
    expect(results.every((r) => r.userId === 'user-123')).toBe(true);
  });

  it('shares the same initialization with sequential consumers too', async () => {
    await getRlsClientAndUserId();
    await requireCurrentUserId();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('starts fresh in a new request scope', async () => {
    await getRlsClientAndUserId();
    hoisted.resetters.forEach((reset) => reset()); // next request

    await getRlsClientAndUserId();
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});

describe('getRlsClientAndUserId — failures are not swallowed', () => {
  it('rejects when getUser returns an error', async () => {
    getUser.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'invalid claim: missing sub claim', code: 'bad_jwt', status: 401 },
    });

    await expect(getRlsClientAndUserId()).rejects.toThrow('Not authenticated');
  });

  it('rejects when getUser returns no user', async () => {
    getUser.mockResolvedValue({ data: { user: null, session: null }, error: null });
    await expect(getRlsClientAndUserId()).rejects.toThrow('Not authenticated');
  });

  it('rejects without touching the network when the cookies are missing', async () => {
    cookieValues.clear();
    await expect(getRlsClientAndUserId()).rejects.toThrow('Not authenticated');
    expect(createClient).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('propagates the same failure through requireCurrentUserId', async () => {
    cookieValues.clear();
    await expect(requireCurrentUserId()).rejects.toThrow('Not authenticated');
  });
});

it.each([429, 503, 0])('does not misclassify temporary auth HTTP %s as missing authentication', async status => {
  getUser.mockResolvedValue({ data: { user: null, session: null }, error: { status, code: 'unexpected_failure' } });
  await expect(getRlsClientAndUserId()).rejects.toThrow(status === 429 ? 'Authentication rate limit' : 'Authentication temporarily unavailable');
});
