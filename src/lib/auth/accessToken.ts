/**
 * Local, UNVERIFIED inspection of a Supabase access token.
 *
 * ⚠️ SECURITY BOUNDARY ⚠️
 *
 * The `exp` claim read here is a *timing hint* and nothing else. It answers a
 * single question — "is it worth spending a network round-trip on a refresh
 * right now?" — and is never evidence of identity:
 *
 * - the JWT signature is NOT verified here;
 * - no value returned by this module may be used as an authorization decision;
 * - a token that fails to decode is treated as stale, so the decision is handed
 *   to Supabase Auth rather than silently trusted.
 *
 * Identity is established by Supabase Auth (`setSession()` → GET /auth/v1/user,
 * or POST /auth/v1/token for the refresh path) and the final say on data access
 * belongs to Postgres RLS (`auth.uid() = user_id`).
 */

/**
 * How long before actual expiry an access token is considered "about to
 * expire" at the request boundary.
 *
 * 60s comfortably outlives a server render, so a token that clears this check
 * cannot expire midway through the RSC pass that is about to use it.
 *
 * It is also deliberately *shorter* than auth-js's own `EXPIRY_MARGIN_MS`
 * (90s), which keeps the browser the primary refresher: the browser rotates
 * first and syncs the new pair down to the cookies, and the request boundary
 * only steps in when no browser tab was alive to do it.
 */
export const ACCESS_TOKEN_REFRESH_MARGIN_SEC = 60;

/**
 * Decode the `exp` claim without verifying the signature.
 *
 * @returns seconds-since-epoch, or null if the token is unparseable.
 */
export function readAccessTokenExp(accessToken: string): number | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload?.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * True when the access token still has more than `marginSec` of life left.
 *
 * False means "spend a refresh round-trip" — never "reject this user".
 */
export function isAccessTokenFresh(
  accessToken: string,
  nowMs: number = Date.now(),
  marginSec: number = ACCESS_TOKEN_REFRESH_MARGIN_SEC
): boolean {
  const exp = readAccessTokenExp(accessToken);
  if (exp === null) {
    return false;
  }
  return exp * 1000 - nowMs > marginSec * 1000;
}
