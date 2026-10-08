import { classifyAuthFailure } from './authFailure';
import { refreshAccessToken } from './refreshSession';

export type SessionTokens = { access_token: string; refresh_token: string };
type Validation = { ok: true; session: SessionTokens } | { ok: false; status: number; error: string };

/** Only call on a JWT already accepted/issued by Supabase Auth, never as signature validation. */
function verifiedSessionId(token: string): string | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return typeof payload.session_id === 'string' && payload.session_id ? payload.session_id : null;
  } catch { return null; }
}

/** getUser validates the access token; exchange validates the opaque refresh token.
 * Both must describe the SAME session, including when a user has several devices.
 * Rotation is returned to the browser, not discarded in a server-only client.
 */
export async function validateSession(tokens: SessionTokens, {
  url, anonKey, fetchImpl = fetch,
}: { url: string; anonKey: string; fetchImpl?: typeof fetch }): Promise<Validation> {
  let response: Response;
  try {
    response = await fetchImpl(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${tokens.access_token}` }, cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch { return { ok: false, status: 503, error: 'Authentication temporarily unavailable' }; }
  const user = await response.json().catch(() => null);
  if (!response.ok) {
    const code = user?.code ?? user?.error_code;
    const kind = classifyAuthFailure({ status: response.status, code });
    const status = kind === 'rate-limit' ? 429 :
      kind === 'invalid' || (kind === 'unexpected' && ['bad_jwt', 'jwt_expired', 'invalid_jwt'].includes(code)) ? 401 : 503;
    return { ok: false, status, error: status === 401 ? 'Invalid session' : 'Authentication temporarily unavailable' };
  }
  if (typeof user?.id !== 'string') return { ok: false, status: 503, error: 'Invalid authentication response' };
  if (!verifiedSessionId(tokens.access_token)) {
    return { ok: false, status: 401, error: 'Invalid session' };
  }
  const refreshed = await refreshAccessToken(tokens.refresh_token, { url, anonKey, fetchImpl });
  if (refreshed.status !== 'refreshed') {
    const status = refreshed.status === 'invalid' ? 401 : refreshed.kind === 'rate-limit' ? 429 : 503;
    return { ok: false, status, error: status === 401 ? 'Invalid session' : 'Authentication temporarily unavailable' };
  }
  const refreshedId = verifiedSessionId(refreshed.session.access_token);
  if (!refreshed.session.user?.id || !refreshedId) {
    return { ok: false, status: 503, error: 'Invalid authentication response' };
  }
  if (refreshed.session.user.id !== user.id || refreshedId !== verifiedSessionId(tokens.access_token)) {
    return { ok: false, status: 401, error: 'Session tokens do not match' };
  }
  return { ok: true, session: {
    access_token: refreshed.session.access_token, refresh_token: refreshed.session.refresh_token,
  } };
}
