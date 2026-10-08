/**
 * One refresh-token exchange against Supabase Auth, usable from the edge
 * runtime.
 *
 * This calls the documented GoTrue token endpoint directly rather than
 * instantiating a `@supabase/supabase-js` client, for two reasons:
 *
 * 1. a GoTrue client created at the request boundary would store the rotated
 *    session in its own in-memory storage, which is exactly the discard we are
 *    trying to eliminate — here the caller owns the result and writes it to the
 *    cookies;
 * 2. it keeps the middleware edge bundle small.
 *
 * The distinction between `invalid` and `error` is load-bearing: a Supabase
 * outage must NOT sign users out, only a genuine refresh-token rejection may.
 */

import { classifyAuthFailure, type AuthFailureKind } from './authFailure';

export interface RefreshedSession {
  access_token: string;
  refresh_token: string;
  user?: { id: string };
}

export type RefreshResult =
  /** Supabase issued a new pair. The caller must persist it. */
  | { status: 'refreshed'; session: RefreshedSession }
  /** Supabase rejected the refresh token. The session is gone; sign the user out. */
  | { status: 'invalid' }
  /** Network/5xx/transport problem. Session validity is unknown — keep the cookies. */
  | { status: 'error'; kind: AuthFailureKind };

export interface RefreshOptions {
  url: string;
  anonKey: string;
  fetchImpl?: typeof fetch;
}

export async function refreshAccessToken(
  refreshToken: string,
  { url, anonKey, fetchImpl = fetch }: RefreshOptions
): Promise<RefreshResult> {
  let response: Response;

  try {
    response = await fetchImpl(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Transport failure — we cannot conclude anything about the session.
    return { status: 'error', kind: 'network' };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const kind = classifyAuthFailure({ status: response.status, code: body?.code ?? body?.error_code ?? body?.error });
    return kind === 'invalid' ? { status: 'invalid' } : { status: 'error', kind };
  }

  try {
    const body = await response.json();
    if (!body?.access_token || typeof body.access_token !== 'string' ||
        !body?.refresh_token || typeof body.refresh_token !== 'string') {
      return { status: 'error', kind: 'unexpected' };
    }
    return {
      status: 'refreshed',
      session: { access_token: body.access_token, refresh_token: body.refresh_token,
        ...(typeof body.user?.id === 'string' ? { user: { id: body.user.id } } : {}) },
    };
  } catch {
    return { status: 'error', kind: 'unexpected' };
  }
}
