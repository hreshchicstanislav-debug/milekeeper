import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from '../../../middleware';

function makeJwt(expSecondsFromNow: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: 'user-123',
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  })}.signature`;
}

const FRESH_AT = makeJwt(3600);
const EXPIRED_AT = makeJwt(-60);

function request(pathname: string, cookies?: Record<string, string>): NextRequest {
  const req = new NextRequest(`https://milekeeper.test${pathname}`);
  for (const [name, value] of Object.entries(cookies ?? {})) {
    req.cookies.set(name, value);
  }
  return req;
}

/** Read a Set-Cookie value off a middleware response. */
function responseCookie(response: Response, name: string) {
  return (response as any).cookies.get(name);
}

/** Read what the downstream RSC render will see as its `cookie` header. */
function forwardedRequestCookies(response: Response): string | null {
  return response.headers.get('x-middleware-request-cookie');
}

const fetchMock = vi.fn();

describe('direct root/login regression', () => {
  it.each(['/', '/en', '/login', '/en/login'])('keeps %s usable with absent, valid, expired and incomplete cookies', async pathname => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const cookies: Array<Record<string, string> | undefined> = [undefined,
      { mk_sb_at: FRESH_AT, mk_sb_rt: 'rt' }, { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'stale-rt' }, { mk_sb_at: FRESH_AT }];
    for (const cookie of cookies) {
      const response = await middleware(request(pathname, cookie));
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('cache-control')).toContain('no-store');
      if (pathname.endsWith('/login') || cookie?.mk_sb_rt === 'rt') {
        expect(response.status).toBe(200);
        expect(response.headers.get('location')).toBeNull();
      } else {
        expect(response.status).toBe(307);
        const target = new URL(response.headers.get('location')!);
        expect(target.pathname).toBe('/auth/recover'); expect(target.searchParams.get('next')).toBe(pathname);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('middleware — isolated public demo', () => {
  it.each(['/demo', '/en/demo'])('never refreshes or changes cookies on %s, including stale sessions', async pathname => {
    for (const cookies of [undefined, { mk_sb_at: FRESH_AT, mk_sb_rt: 'existing' }, { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'expired' }]) {
      const req = request(pathname, cookies);
      const before = req.cookies.toString();
      const response = await middleware(req);
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(req.cookies.toString()).toBe(before);
      expect(response.headers.get('location')).toBeNull();
      if (pathname === '/en/demo') expect(response.headers.get('x-middleware-rewrite')).toBe('https://milekeeper.test/demo');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['/', '/items', '/history', '/items/123', '/en/items', '/en/history', '/demo-other', '/demo/items', '/en/demo/items'])('keeps %s protected', async pathname => {
    expect((await middleware(request(pathname))).status).toBe(307);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.NEXT_PUBLIC_DEV_GUEST_MODE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_DEV_GUEST_MODE;
});

describe('middleware — public routes', () => {
  it('lets /login through without auth and without touching the network', async () => {
    const response = await middleware(request('/login'));
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets /auth/callback through so the PKCE exchange can run', async () => {
    const response = await middleware(request('/auth/callback'));
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies no-store headers', async () => {
    const response = await middleware(request('/login'));
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('no-store');
  });
});

describe('middleware — fresh access token', () => {
  it('does not refresh and does not rewrite the cookies', async () => {
    const response = await middleware(
      request('/', { mk_sb_at: FRESH_AT, mk_sb_rt: 'rt-0' })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(responseCookie(response, 'mk_sb_at')).toBeUndefined();
    expect(responseCookie(response, 'mk_sb_rt')).toBeUndefined();
  });
});

describe('middleware — missing cookies', () => {
  it('redirects to /login', async () => {
    const response = await middleware(request('/'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://milekeeper.test/auth/recover?next=%2F');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects when only the access token is present', async () => {
    const response = await middleware(request('/', { mk_sb_at: FRESH_AT }));
    expect(response.status).toBe(307);
  });
});

describe('middleware — browser owns expired session recovery', () => {
  it.each(['/', '/history', '/en', '/en/history'])('sends %s to a public recovery UI without exchanging or deleting tokens', async pathname => {
    const req = request(pathname, { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-old' });
    const response = await middleware(req);
    const location = new URL(response.headers.get('location')!);
    expect(response.status).toBe(307);
    expect(location.pathname).toBe('/auth/recover');
    expect(location.searchParams.get('next')).toBe(pathname);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(req.cookies.get('mk_sb_rt')?.value).toBe('rt-old');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps recovery public even with an expired pair, preventing redirect loops', async () => {
    const response = await middleware(request('/auth/recover?next=%2Fhistory', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-old' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('never rotates tokens during concurrent page/prefetch requests', async () => {
    await Promise.all(Array.from({ length: 8 }, () => middleware(request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-old' }))));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('preserves the existing dev-only guest behavior', async () => {
    process.env.NEXT_PUBLIC_DEV_GUEST_MODE = '1';
    expect((await middleware(request('/'))).status).toBe(200);
    expect((await middleware(request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-old' }))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('middleware — matcher scope', () => {
  // The matcher is a static string that Next compiles with path-to-regexp; it
  // is never exercised by calling middleware() directly, so these tests compile
  // the literal themselves. For a pattern of this shape — a single leading
  // slash followed by one negative-lookahead group — an anchored RegExp is an
  // exact stand-in, and the real behaviour is re-checked over HTTP on preview.
  const pattern = (config.matcher as string[])[0];
  const matcher = new RegExp(`^${pattern}$`);

  const runsMiddleware = (pathname: string) => matcher.test(pathname);

  it('exposes exactly one matcher pattern', () => {
    expect(config.matcher).toHaveLength(1);
  });

  describe('public PWA assets bypass the middleware entirely', () => {
    // Skipping the middleware is what keeps these off the auth path *and* off
    // withNoStore(), so they can be cached by the browser like normal statics.
    it.each([
      '/manifest.webmanifest',
      '/favicon.ico',
      '/apple-icon.png',
      '/icon-192.png',
      '/icon-512.png',
      '/icon-maskable-512.png',
    ])('%s', (pathname) => {
      expect(runsMiddleware(pathname)).toBe(false);
    });
  });

  describe('protected app routes still run through the middleware', () => {
    it.each([
      '/',
      '/items',
      '/items/6f1c0b2e-0000-4000-8000-000000000000',
      '/history',
    ])('%s', (pathname) => {
      expect(runsMiddleware(pathname)).toBe(true);
    });
  });

  describe('auth routes still run through the middleware', () => {
    // They are public, but isPublicPath() is what makes them so — the
    // middleware still has to see them to apply no-store and to bounce a
    // signed-in user off /login.
    it.each(['/login', '/auth/callback'])('%s', (pathname) => {
      expect(runsMiddleware(pathname)).toBe(true);
    });
  });

  it('does not let a protected route hide behind an asset name', () => {
    // The lookahead is anchored at the start of the path, so only a top-level
    // asset is excluded — nothing nested under a real route.
    expect(runsMiddleware('/items/icon-192.png')).toBe(true);
    expect(runsMiddleware('/history/manifest.webmanifest')).toBe(true);
  });

  it('still excludes API routes and Next internals', () => {
    expect(runsMiddleware('/api/auth/sync')).toBe(false);
    expect(runsMiddleware('/_next/static/chunks/abc123.js')).toBe(false);
    expect(runsMiddleware('/_next/image')).toBe(false);
  });
});

describe('middleware — PWA assets are not reachable through isPublicPath', () => {
  // Belt and braces for the matcher: even if a request for an asset somehow
  // reached the middleware, it must not have been quietly promoted to a public
  // path, because that would also hand it no-store headers.
  it.each(['/manifest.webmanifest', '/icon-192.png', '/apple-icon.png'])(
    '%s still redirects when it reaches the middleware without a session',
    async (pathname) => {
      const response = await middleware(request(pathname));
      expect(response.status).toBe(307);
    }
  );
});

describe('middleware — locale routing without auth changes', () => {
  it.each(['/en', '/en/items', '/en/items/123', '/en/history'])('protects %s with English login', async pathname => {
    const response = await middleware(request(pathname));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe(pathname);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rewrites English login to the existing public login and overwrites a spoofed locale header', async () => {
    const req = request('/en/login'); req.headers.set('x-milekeeper-locale', 'ru');
    const response = await middleware(req);
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://milekeeper.test/login');
    expect(response.headers.get('x-middleware-request-x-milekeeper-locale')).toBe('en');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses URL locale regardless of a saved cookie or browser language', async () => {
    const req = request('/login', { mk_locale: 'en' }); req.headers.set('accept-language', 'en-US');
    const response = await middleware(req);
    expect(response.headers.get('x-middleware-request-x-milekeeper-locale')).toBe('ru');
    expect(response.headers.get('location')).toBeNull();
  });
  it('keeps the shared callback public and uses only a validated locale preference', async () => {
    const en = await middleware(request('/auth/callback?code=one-use', { mk_locale: 'en' }));
    expect(en.headers.get('x-middleware-request-x-milekeeper-locale')).toBe('en');
    expect(en.headers.get('x-middleware-rewrite')).toBeNull();
    const bad = await middleware(request('/auth/callback', { mk_locale: 'https://evil.test' }));
    expect(bad.headers.get('x-middleware-request-x-milekeeper-locale')).toBe('ru');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('switches locale with a fresh session without refreshing or clearing auth cookies', async () => {
    for (const pathname of ['/items', '/en/items', '/items']) {
      const req = request(pathname, { mk_sb_at: FRESH_AT, mk_sb_rt: 'rt-0' });
      const response = await middleware(req);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(req.cookies.get('mk_sb_rt')?.value).toBe('rt-0');
      expect(response.status).toBe(200);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps the recovery locale from the requested destination', async () => {
    const response = await middleware(request('/auth/recover?next=%2Fen%2Fhistory'));
    expect(response.headers.get('x-middleware-request-x-milekeeper-locale')).toBe('en');
  });
});
