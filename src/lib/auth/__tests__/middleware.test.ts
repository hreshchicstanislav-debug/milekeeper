import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../../middleware';

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
    expect(response.headers.get('location')).toBe('https://milekeeper.test/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects when only the access token is present', async () => {
    const response = await middleware(request('/', { mk_sb_at: FRESH_AT }));
    expect(response.status).toBe(307);
  });
});

describe('middleware — expired access token, valid refresh token', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at-new', refresh_token: 'rt-new' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('refreshes exactly once against the Supabase token endpoint', async () => {
    await middleware(request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-0' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/auth/v1/token?grant_type=refresh_token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ refresh_token: 'rt-0' });
  });

  it('writes the rotated pair to the response so the browser keeps up', async () => {
    const response = await middleware(
      request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-0' })
    );

    expect(responseCookie(response, 'mk_sb_at')).toMatchObject({
      value: 'at-new',
      httpOnly: true,
      secure: true,
      path: '/',
    });
    expect(responseCookie(response, 'mk_sb_rt')).toMatchObject({
      value: 'rt-new',
      httpOnly: true,
    });
  });

  it('forwards the rotated pair to the current render, not the stale one', async () => {
    // Without this the RSC pass would re-refresh with the old token and throw
    // the rotated result away — the drift that terminates Supabase sessions.
    const response = await middleware(
      request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-0' })
    );

    const forwarded = forwardedRequestCookies(response);
    expect(forwarded).toContain('mk_sb_at=at-new');
    expect(forwarded).toContain('mk_sb_rt=rt-new');
    expect(forwarded).not.toContain('rt-0');
  });

  it('lets the request continue', async () => {
    const response = await middleware(
      request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-0' })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('middleware — invalid refresh token', () => {
  it('clears the cookies and redirects to /login', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );

    const response = await middleware(
      request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-dead' })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://milekeeper.test/login');
    expect(responseCookie(response, 'mk_sb_at')).toMatchObject({ value: '', maxAge: 0 });
    expect(responseCookie(response, 'mk_sb_rt')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('does not reach page rendering, so no runtime "Not authenticated" screen', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    const response = await middleware(
      request('/history', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-dead' })
    );
    expect(response.status).toBe(307);
  });
});

describe('middleware — Supabase unavailable', () => {
  it('keeps the session on a network failure instead of signing the user out', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const response = await middleware(
      request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-0' })
    );

    expect(response.status).toBe(200);
    expect(responseCookie(response, 'mk_sb_at')).toBeUndefined();
  });

  it('keeps the session on a 5xx', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));

    const response = await middleware(
      request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-0' })
    );

    expect(response.status).toBe(200);
    expect(responseCookie(response, 'mk_sb_at')).toBeUndefined();
  });
});

describe('middleware — dev-guest mode', () => {
  // The dev-only escape hatch already honoured by AuthGate and page.tsx. It must
  // keep working now that the request boundary actually guards routes locally.
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEV_GUEST_MODE = '1';
  });

  it('lets an unauthenticated developer through instead of redirecting', async () => {
    const response = await middleware(request('/'));
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops a dead session but still renders the page', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 400 }));

    const response = await middleware(
      request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-dead' })
    );

    expect(response.status).toBe(200);
    expect(responseCookie(response, 'mk_sb_at')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('still refreshes and persists a live session', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at-new', refresh_token: 'rt-new' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await middleware(
      request('/', { mk_sb_at: EXPIRED_AT, mk_sb_rt: 'rt-0' })
    );

    expect(responseCookie(response, 'mk_sb_at')).toMatchObject({ value: 'at-new' });
    expect(forwardedRequestCookies(response)).toContain('mk_sb_at=at-new');
  });
});
