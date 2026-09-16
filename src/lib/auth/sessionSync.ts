/**
 * Browser → server session sync.
 *
 * The browser owns the Supabase session (localStorage, rotated by auth-js);
 * the server reads it from httpOnly cookies. This module is the single bridge
 * between the two, and the decision logic is kept pure so it can be unit
 * tested without mounting a React tree.
 *
 * The important invariant: a token is only ever recorded as "synced" after the
 * server has confirmed it with a 2xx. A dropped POST must leave the state
 * retryable, because a cookie that silently falls two refresh-token
 * generations behind is what terminates the whole Supabase session.
 */

export type SyncedState =
  | { kind: 'session'; accessToken: string }
  | { kind: 'signed-out' }
  | null;

export type SyncAction = 'sync' | 'logout' | 'none';

/**
 * Decide whether the current session still needs to be pushed to the server.
 *
 * `synced` is the last state *confirmed* by the server, never merely attempted.
 */
export function nextSyncAction(
  synced: SyncedState,
  accessToken: string | null | undefined
): SyncAction {
  if (!accessToken) {
    return synced?.kind === 'signed-out' ? 'none' : 'logout';
  }
  if (synced?.kind === 'session' && synced.accessToken === accessToken) {
    return 'none';
  }
  return 'sync';
}

/**
 * POST once, and retry exactly once on a transient failure.
 *
 * A 4xx is a definitive answer and is never retried; anything else (network
 * error, 5xx) gets one more attempt and then gives up so the caller can retry
 * on the next auth event.
 */
async function postOnceWithRetry(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(input, init);
      if (response.ok) {
        return true;
      }
      if (response.status >= 400 && response.status < 500) {
        return false;
      }
    } catch {
      // transient — fall through to the second attempt
    }
  }
  return false;
}

/**
 * Push the session to the httpOnly cookies.
 *
 * `keepalive` lets the request survive a navigation or the tab being
 * backgrounded — the exact moments an iOS standalone web app used to lose it.
 *
 * @returns true only when the server confirmed the write.
 */
export function postSessionSync(
  tokens: { access_token: string; refresh_token: string },
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  return postOnceWithRetry(
    '/api/auth/sync',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens),
      keepalive: true,
    },
    fetchImpl
  );
}

/** Clear the httpOnly cookies. @returns true only when the server confirmed it. */
export function postSessionLogout(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return postOnceWithRetry('/api/auth/logout', { method: 'POST', keepalive: true }, fetchImpl);
}
