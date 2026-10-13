import { NextRequest, NextResponse } from 'next/server';
import { authResponse, readAuthRequest } from '@/lib/auth/authRequest';
import { refreshAccessToken } from '@/lib/auth/refreshSession';
import { readAuthCookiesFromRequest, setAuthCookiesOnResponse } from '@/lib/supabase/authTokenCookies';

/** Compatibility fallback for a valid cookie session without SDK storage.
 * The refresh endpoint validates the opaque credential. Never return the
 * unvalidated incoming cookies, and never revoke other devices on failure.
 */
export async function POST(req: NextRequest) {
  const body = await readAuthRequest(req);
  if (body instanceof NextResponse) return body;
  if (Object.keys(body).length) return authResponse({ ok: false }, 400);
  const { refreshToken } = readAuthCookiesFromRequest(req);
  if (!refreshToken) return authResponse({ ok: false, reason: 'missing_session' }, 401);
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return authResponse({ ok: false }, 503);
  const result = await refreshAccessToken(refreshToken, { url, anonKey });
  if (result.status !== 'refreshed') {
    return authResponse({ ok: false }, result.status === 'invalid' ? 401 : result.kind === 'rate-limit' ? 429 : 503);
  }
  if (!result.session.user?.id) return authResponse({ ok: false }, 503);
  const session = { access_token: result.session.access_token, refresh_token: result.session.refresh_token };
  const response = authResponse({ ok: true, session });
  setAuthCookiesOnResponse(response, session.access_token, session.refresh_token);
  return response;
}
