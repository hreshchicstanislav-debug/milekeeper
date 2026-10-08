import { classifyAuthFailure, type AuthFailureKind } from './authFailure';

export const SDK_RATE_LIMIT_MESSAGE = 'Supabase Auth rate limit exceeded (HTTP 429)';

/** auth-js 2.90's refresh removes storage on every non-retryable AuthError.
 * Its transport recognizes only 502/503/504 as retryable. Adapt temporary
 * refresh failures to its documented custom fetch transport; never fake success.
 * Other endpoints (including OAuth, getUser, logout, PostgREST) pass through.
 */
export function sessionSafeFetch(supabaseUrl: string, fetchImpl: typeof fetch = fetch): typeof fetch {
  const tokenUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token`);
  let retryAt = 0;
  let failureKind: AuthFailureKind = 'unavailable';
  function temporary(kind: AuthFailureKind, response?: Response) {
    failureKind = kind;
    const retryAfter = response?.headers.get('retry-after');
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
    const delay = seconds !== null ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 30000;
    retryAt = Date.now() + Math.max(30000, Number.isFinite(delay) ? delay : 30000);
    return retryableResponse();
  }
  function retryableResponse() {
    // message is deliberately token-free; auth-js reads it on retryable responses.
    const message = failureKind === 'rate-limit' ? SDK_RATE_LIMIT_MESSAGE : 'Supabase Auth temporarily unavailable';
    return Object.assign(new Response(JSON.stringify({ error: message }), { status: 503 }), { message });
  }
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const isAuth = url.origin === tokenUrl.origin && url.pathname.startsWith(tokenUrl.pathname.slice(0, -5));
    const fetchInit = isAuth ? { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) } : init;
    if (url.origin !== tokenUrl.origin || url.pathname !== tokenUrl.pathname ||
        url.searchParams.get('grant_type') !== 'refresh_token' || method.toUpperCase() !== 'POST') {
      return fetchImpl(input, fetchInit);
    }
    if (Date.now() < retryAt) return retryableResponse();
    let response: Response;
    try { response = await fetchImpl(input, fetchInit); }
    catch { return temporary('network'); }
    const body = await response.clone().json().catch(() => null);
    if (response.ok) {
      if (typeof body?.access_token !== 'string' || !body.access_token ||
          typeof body?.refresh_token !== 'string' || !body.refresh_token ||
          typeof body?.expires_in !== 'number' || body.expires_in <= 0 || typeof body?.user?.id !== 'string') {
        return temporary('unexpected');
      }
      retryAt = 0;
      return response;
    }
    const kind = classifyAuthFailure({ status: response.status, code: body?.code ?? body?.error_code ?? body?.error });
    return kind === 'invalid' ? response : temporary(kind, response);
  };
}
