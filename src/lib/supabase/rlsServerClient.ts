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
 * initialization: one client, one `getUser()`, no server-only refresh.
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
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // Validate with Auth; attach the same JWT to PostgREST without setSession.
  // setSession can refresh expired tokens even with autoRefreshToken=false,
  // losing the rotated pair inside renders/actions that cannot persist it.
  const { data, error } = await supabase.auth.getUser(accessToken);

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
  if (!data.user) {
    throw new AuthenticationRequiredError();
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
