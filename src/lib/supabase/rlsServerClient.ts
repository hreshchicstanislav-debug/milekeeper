import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { COOKIE_AT, COOKIE_RT } from './authCookieConfig';
import { AuthenticationRequiredError, AuthenticationUnavailableError, classifyAuthFailure } from '@/lib/auth/authFailure';

function getEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) env var.');
  }
  if (!anonKey) {
    throw new Error('Missing SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) env var.');
  }
  return { url, anonKey };
}

let hasWarnedAboutUnpersistedRefresh = false;

function warnAboutUnpersistedRefresh() {
  if (process.env.NODE_ENV === 'production' || hasWarnedAboutUnpersistedRefresh) {
    return;
  }
  hasWarnedAboutUnpersistedRefresh = true;
  console.warn(
    '[auth] Access token expired between the request boundary and a data call, so the ' +
      'refresh happened inside the render. The rotated token could NOT be written back to ' +
      'the cookies (Server Components cannot set cookies). This request is served correctly, ' +
      'but the cookies are one generation behind until the browser or middleware resyncs. ' +
      'If this fires often, ACCESS_TOKEN_REFRESH_MARGIN_SEC is too small.'
  );
}

/**
 * Resolve the RLS-scoped Supabase client and the authenticated user id for the
 * current server request.
 *
 * Wrapped in React's `cache()`, which is **request-scoped**: the memoization
 * lives in the per-request store React keeps on `ReactSharedInternals.A`
 * (backed by AsyncLocalStorage in Next's server runtime), so two different
 * requests — and therefore two different users — can never observe each
 * other's entry. If no React request scope is active at a given call site,
 * `cache()` degrades to a plain pass-through call (React returns
 * `fn.apply(null, arguments)` when there is no dispatcher), so the worst case
 * is a missed dedupe, never a leak.
 *
 * A module-level `let client` singleton would be the dangerous alternative: on
 * a warm serverless instance it would outlive the request and hand one user's
 * authenticated session to the next user. Never do that here. For the same
 * reason this must not be wrapped in `unstable_cache`, which persists across
 * requests by design.
 *
 * What the dedupe buys us: the Home render fans out into four data functions.
 * Before, each built its own client, its own session and its own refresh —
 * four concurrent refreshes of the same refresh token. Now they all await one
 * initialization: one client, one `setSession()`, at most one refresh.
 */
export const getRlsClientAndUserId = cache(async () => {
  const { url, anonKey } = getEnv();

  const c = await cookies();
  const accessToken = c.get(COOKIE_AT)?.value ?? null;
  const refreshToken = c.get(COOKIE_RT)?.value ?? null;

  if (!accessToken || !refreshToken) {
    throw new AuthenticationRequiredError();
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // setSession() attaches the session so auth.uid() is available for RLS, and
  // it is also the identity check: for a live access token auth-js calls
  // GET /auth/v1/user, and for an expired one it exchanges the refresh token at
  // POST /auth/v1/token. Either way the user it returns comes from Supabase
  // Auth, not from decoding the JWT locally — so there is no reason to spend a
  // second round-trip on getUser() afterwards.
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    const kind = classifyAuthFailure(error);
    // getUser's explicit JWT rejection is definitive; transport/rate limits are not.
    if (kind === 'invalid' || (kind === 'unexpected' && (
      error.code === 'bad_jwt' || error.code === 'jwt_expired' || error.code === 'invalid_jwt' ||
      error.name === 'AuthSessionMissingError'
    ))) {
      throw new AuthenticationRequiredError();
    }
    throw new AuthenticationUnavailableError(kind);
  }
  if (!data.session || !data.user) {
    throw new AuthenticationRequiredError();
  }

  if (data.session.refresh_token !== refreshToken) {
    // Fallback path: middleware should have refreshed at the boundary, but the
    // token expired in between. The request itself is fine — the client holds
    // the fresh session in memory and PostgREST will use it — yet the rotated
    // token is genuinely lost, and we say so instead of pretending otherwise.
    warnAboutUnpersistedRefresh();
  }

  return { supabase, userId: data.user.id };
});

export async function requireCurrentUserId() {
  const { userId } = await getRlsClientAndUserId();
  return userId;
}

/**
 * @deprecated Use {@link getRlsClientAndUserId}, which returns the same client
 * alongside the authenticated user id.
 */
export async function createRlsServerClient() {
  const { supabase } = await getRlsClientAndUserId();
  return supabase;
}
