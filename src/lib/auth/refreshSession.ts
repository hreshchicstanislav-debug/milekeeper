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

export interface RefreshedSession {
  access_token: string;
  refresh_token: string;
}

export type RefreshResult =
  /** Supabase issued a new pair. The caller must persist it. */
  | { status: 'refreshed'; session: RefreshedSession }
  /** Supabase rejected the refresh token. The session is gone; sign the user out. */
  | { status: 'invalid' }
  /** Network/5xx/transport problem. Session validity is unknown — keep the cookies. */
  | { status: 'error' };

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
    });
  } catch {
    // Transport failure — we cannot conclude anything about the session.
    return { status: 'error' };
  }

  if (!response.ok) {
    // 4xx from GoTrue means the refresh token really is unusable
    // (expired, already-used beyond the reuse window, or session terminated).
    // 5xx means Supabase is unhappy, not the user.
    return response.status >= 400 && response.status < 500
      ? { status: 'invalid' }
      : { status: 'error' };
  }

  try {
    const body = await response.json();
    if (typeof body?.access_token !== 'string' || typeof body?.refresh_token !== 'string') {
      return { status: 'error' };
    }
    return {
      status: 'refreshed',
      session: { access_token: body.access_token, refresh_token: body.refresh_token },
    };
  } catch {
    return { status: 'error' };
  }
}
