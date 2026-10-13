import type { SessionTokens } from './validateSession';

export type SyncedState = { kind: 'session'; accessToken: string } | { kind: 'signed-out' } | null;
export function nextSyncAction(synced: SyncedState, accessToken: string | null | undefined): 'sync' | 'logout' | 'none' {
  if (!accessToken) return synced?.kind === 'signed-out' ? 'none' : 'logout';
  return synced?.kind === 'session' && synced.accessToken === accessToken ? 'none' : 'sync';
}
export type SessionSyncResult = { ok: true; session: SessionTokens } | { ok: false; status: number; missing?: true };

/** One bounded retry for network/5xx; never retry rate limiting automatically. */
async function post(input: string, body: object, fetchImpl: typeof fetch): Promise<{ status: number; body: unknown }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(input, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), credentials: 'same-origin', keepalive: true,
        cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      if (response.status >= 500 && attempt === 0) continue;
      return { status: response.status, body: await response.json().catch(() => null) };
    } catch {
      if (attempt === 1) return { status: 503, body: null };
    }
  }
  return { status: 503, body: null };
}

export async function postSessionSync(tokens: SessionTokens, fetchImpl: typeof fetch = fetch): Promise<SessionSyncResult> {
  // getSession() returns the full SDK Session at runtime; its TypeScript shape
  // does not strip OAuth/provider fields. Keep the strict endpoint contract.
  const response = await post('/api/auth/sync', {
    access_token: tokens.access_token, refresh_token: tokens.refresh_token,
  }, fetchImpl);
  const body = response.body as { ok?: boolean; session?: SessionTokens } | null;
  if (response.status === 200 && body?.ok === true &&
      typeof body.session?.access_token === 'string' && body.session.access_token &&
      typeof body.session.refresh_token === 'string' && body.session.refresh_token) {
    return { ok: true, session: body.session };
  }
  return { ok: false, status: response.status === 200 ? 503 : response.status };
}

export async function postSessionLogout(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const response = await post('/api/auth/logout', {}, fetchImpl);
  return response.status === 200 && (response.body as { ok?: boolean } | null)?.ok === true;
}

/** Same-origin cookie fallback for a missing/rejected SDK session. Shares the
 * bounded transport and never sends tokens in URLs or logs. */
export async function postSessionRecovery(fetchImpl: typeof fetch = fetch): Promise<SessionSyncResult> {
  const response = await post('/api/auth/recover', {}, fetchImpl);
  const body = response.body as { ok?: boolean; session?: SessionTokens; reason?: string } | null;
  if (response.status === 200 && body?.ok === true &&
      typeof body.session?.access_token === 'string' && body.session.access_token &&
      typeof body.session.refresh_token === 'string' && body.session.refresh_token) {
    return { ok: true, session: body.session };
  }
  return { ok: false, status: response.status === 200 ? 503 : response.status,
    ...(response.status === 401 && body?.reason === 'missing_session' ? { missing: true as const } : {}) };
}
