import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

export const COOKIE_AT = 'mk_sb_at';
export const COOKIE_RT = 'mk_sb_rt';

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
  res.cookies.set(COOKIE_AT, accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  res.cookies.set(COOKIE_RT, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearAuthCookiesOnResponse(res: NextResponse) {
  res.cookies.set(COOKIE_AT, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  res.cookies.set(COOKIE_RT, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

