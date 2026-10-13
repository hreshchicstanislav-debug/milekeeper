import { localeFromPath, stripLocale, LOCALE_HEADER, LOCALE_COOKIE, callbackLocale } from '@/lib/i18n/routing';
import { isDemoPath } from '@/lib/demo/routing';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_AT, COOKIE_RT } from '@/lib/supabase/authCookieConfig';
import { isAccessTokenFresh } from '@/lib/auth/accessToken';

// Middleware never rotates tokens. The browser coordinator owns refresh and
// persists the resulting pair in both SDK storage and HttpOnly cookies before
// navigating. Independent edge exchanges race SDK refreshes and parallel RSCs.

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
    pathname === '/auth/recover' ||
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

function redirectToRecovery(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = '/auth/recover';
  url.search = '';
  url.searchParams.set('next', next);
  // Preserve both stores. A missing/expired cookie is not proof that the
  // browser session is invalid; recovery must run before any cookie deletion.
  return withNoStore(NextResponse.redirect(url));
}

export async function middleware(request: NextRequest) {
  const originalPath = request.nextUrl.pathname;
  const locale = originalPath === '/auth/callback' || originalPath === '/auth/recover'
    ? (originalPath === '/auth/recover' ? localeFromPath(request.nextUrl.searchParams.get('next') ?? '/')
      : callbackLocale(request.cookies.get(LOCALE_COOKIE)?.value)) : localeFromPath(originalPath);
  const pathname = stripLocale(originalPath);
  // Always overwrite the client-supplied header. Locale never grants access.
  request.headers.set(LOCALE_HEADER, locale);
  const proceed = () => {
    const headers = new Headers(request.headers);
    if (localeFromPath(originalPath) === 'en' && /^(\/|\/login|\/demo|\/history|\/items(?:\/[^/]+)?)$/.test(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = pathname;
      return NextResponse.rewrite(url, { request: { headers } });
    }
    return NextResponse.next({ request: { headers } });
  };

  if (isDemoPath(originalPath) || isPublicPath(originalPath) || originalPath === '/en/login') {
    return withNoStore(proceed());
  }

  const devGuest = isDevGuestEnabled();
  const accessToken = request.cookies.get(COOKIE_AT)?.value ?? null;
  const refreshToken = request.cookies.get(COOKIE_RT)?.value ?? null;

  if (devGuest || (accessToken && refreshToken && isAccessTokenFresh(accessToken))) {
    // Freshness is only a timing hint. Server getUser and RLS still validate
    // identity and ownership before any data access.
    return withNoStore(proceed());
  }
  return redirectToRecovery(request);
}

export const config = {
  // Match all routes except static files and API routes
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     *
     * and except the public PWA assets, which must be reachable without a
     * session. A web app manifest is fetched with `credentials: omit`, so the
     * request arrives without the auth cookies no matter who is signed in;
     * routing it through this middleware would answer it — and every icon
     * beside it — with a 307 to /login and silently break installability.
     *
     * These are excluded at the matcher rather than in isPublicPath() on
     * purpose: skipping the middleware entirely also skips withNoStore(), so
     * the icons keep their normal static cache headers instead of being
     * re-downloaded on every launch.
     *
     * Each asset is listed by name rather than by a broad `.png`-style pattern
     * so that no future route can fall through the gap by accident. A service
     * worker and an offline page would be added here the same way.
     */
    '/((?!api|_next/static|_next/image|favicon\\.ico|apple-icon\\.png|icon-192\\.png|icon-512\\.png|icon-maskable-512\\.png|manifest\\.webmanifest).*)',
  ],
};
