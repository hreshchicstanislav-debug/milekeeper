/**
 * Names and attributes of the httpOnly cookies that mirror the browser's
 * Supabase session onto the server.
 *
 * This module is deliberately free of any `next/headers` import so that it can
 * be shared by middleware (edge runtime), route handlers and server components
 * alike. `authTokenCookies.ts` re-exports the names for existing callers.
 */

export const COOKIE_AT = 'mk_sb_at';
export const COOKIE_RT = 'mk_sb_rt';

export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * httpOnly so the tokens can be used server-side for RLS but stay unreadable
 * from JS. `secure` is fine on localhost too — browsers treat it as a
 * trustworthy origin.
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;
