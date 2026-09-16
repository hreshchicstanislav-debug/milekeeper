import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_OPTIONS, COOKIE_AT, COOKIE_RT } from './authCookieConfig';

// Names live in authCookieConfig.ts so middleware (edge runtime) can share them
// without pulling in `next/headers`. Re-exported here for existing callers.
export { COOKIE_AT, COOKIE_RT };

export function readAuthCookiesFromRequest(req: NextRequest) {
  const accessToken = req.cookies.get(COOKIE_AT)?.value ?? null;
  const refreshToken = req.cookies.get(COOKIE_RT)?.value ?? null;
  return { accessToken, refreshToken };
}

export async function readAuthCookiesFromNextCookies() {
  const c = await cookies();
  const accessToken = c.get(COOKIE_AT)?.value ?? null;
  const refreshToken = c.get(COOKIE_RT)?.value ?? null;
  return { accessToken, refreshToken };
}

export function setAuthCookiesOnResponse(
  res: NextResponse,
  accessToken: string,
  refreshToken: string
) {
  // httpOnly so it can be used server-side for RLS, but not readable by JS.
  res.cookies.set(COOKIE_AT, accessToken, { ...AUTH_COOKIE_OPTIONS, maxAge: AUTH_COOKIE_MAX_AGE });
  res.cookies.set(COOKIE_RT, refreshToken, { ...AUTH_COOKIE_OPTIONS, maxAge: AUTH_COOKIE_MAX_AGE });
}

export function clearAuthCookiesOnResponse(res: NextResponse) {
  res.cookies.set(COOKIE_AT, '', { ...AUTH_COOKIE_OPTIONS, maxAge: 0 });
  res.cookies.set(COOKIE_RT, '', { ...AUTH_COOKIE_OPTIONS, maxAge: 0 });
}
