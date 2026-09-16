import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_OPTIONS,
  COOKIE_AT,
  COOKIE_RT,
} from '@/lib/supabase/authCookieConfig';
import { isAccessTokenFresh } from '@/lib/auth/accessToken';
import { refreshAccessToken } from '@/lib/auth/refreshSession';

/**
 * Auth request boundary.
 *
 * This is the only place in the app where a refresh can be *persisted*:
 * Server Components cannot modify response cookies, so a refresh performed
 * during an RSC render is necessarily thrown away. Doing the refresh here
 * instead lets us write the rotated pair to both:
 *
 * - `request.cookies`, so the RSC render that follows in this very request
 *   already sees the new tokens (mutating them rewrites the forwarded
 *   `cookie` header, which `NextResponse.next({ request })` passes downstream);
 * - `response.cookies`, so the browser stores the new pair for next time.
 *
 * That is what stops the cookies from drifting generations behind the
 * browser's own session and tripping Supabase's refresh-token reuse detection.
 */

/**
 * Mirrors the check in AuthGate and page.tsx. Without this, enabling dev-guest
 * mode would be pointless: middleware would bounce the unauthenticated
 * developer to /login before the page ever got the chance to render its
 * empty-state fallback.
 */
function isDevGuestEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_GUEST_MODE === '1';
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/auth/callback' ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  );
}

function withNoStore(response: NextResponse): NextResponse {
  // Disable caching for all pages to ensure fresh data on Vercel
  // This prevents Vercel CDN from caching stale data
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  return response;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  const response = NextResponse.redirect(url);
  // Drop the unusable pair so the next request cannot loop on it.
  response.cookies.set(COOKIE_AT, '', { ...AUTH_COOKIE_OPTIONS, maxAge: 0 });
  response.cookies.set(COOKIE_RT, '', { ...AUTH_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}

function readSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return withNoStore(NextResponse.next());
  }

  const devGuest = isDevGuestEnabled();
  const accessToken = request.cookies.get(COOKIE_AT)?.value ?? null;
  const refreshToken = request.cookies.get(COOKIE_RT)?.value ?? null;

  if (!accessToken || !refreshToken) {
    return devGuest ? withNoStore(NextResponse.next()) : redirectToLogin(request);
  }

  // Timing hint only — see src/lib/auth/accessToken.ts. A "fresh" token is not
  // trusted here, it is merely not worth a refresh round-trip; Supabase Auth
  // still validates it in getRlsClientAndUserId() and RLS still gates the data.
  if (isAccessTokenFresh(accessToken)) {
    return withNoStore(NextResponse.next());
  }

  const env = readSupabaseEnv();
  if (!env) {
    // Misconfiguration is not an auth failure — let the server client raise the
    // explicit "Missing SUPABASE_URL" error rather than silently logging out.
    return withNoStore(NextResponse.next());
  }

  const result = await refreshAccessToken(refreshToken, env);

  if (result.status === 'invalid') {
    if (!devGuest) {
      return redirectToLogin(request);
    }
    // Dev-guest: drop the dead pair but let the page render its empty state.
    const passthrough = NextResponse.next();
    passthrough.cookies.set(COOKIE_AT, '', { ...AUTH_COOKIE_OPTIONS, maxAge: 0 });
    passthrough.cookies.set(COOKIE_RT, '', { ...AUTH_COOKIE_OPTIONS, maxAge: 0 });
    return withNoStore(passthrough);
  }

  if (result.status === 'error') {
    // Supabase is unreachable or erroring. The session may well still be valid,
    // so keep the cookies and let the request through rather than signing the
    // user out over an outage.
    return withNoStore(NextResponse.next());
  }

  const { access_token, refresh_token } = result.session;

  // Request side: this render sees the rotated pair.
  request.cookies.set(COOKIE_AT, access_token);
  request.cookies.set(COOKIE_RT, refresh_token);

  // Response side: the browser stores it for the next request.
  const response = NextResponse.next({ request });
  response.cookies.set(COOKIE_AT, access_token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  response.cookies.set(COOKIE_RT, refresh_token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: AUTH_COOKIE_MAX_AGE,
  });

  return withNoStore(response);
}

export const config = {
  // Match all routes except static files and API routes
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
