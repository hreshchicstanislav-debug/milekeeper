import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookiesOnResponse } from '@/lib/supabase/authTokenCookies';
import { authResponse, readAuthRequest } from '@/lib/auth/authRequest';
import { validateSession } from '@/lib/auth/validateSession';

export async function POST(req: NextRequest) {
  const body = await readAuthRequest(req);
  if (body instanceof NextResponse) return body;
  const { access_token, refresh_token } = body;
  if (Object.keys(body).some(key => key !== 'access_token' && key !== 'refresh_token') ||
      typeof access_token !== 'string' || !access_token.trim() || access_token.length > 16384 ||
      typeof refresh_token !== 'string' || !refresh_token.trim() || refresh_token.length > 4096) {
    return authResponse({ ok: false, error: 'missing or invalid tokens' }, 400);
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return authResponse({ ok: false, error: 'Authentication unavailable' }, 503);
  const result = await validateSession({ access_token, refresh_token }, { url, anonKey });
  if (!result.ok) return authResponse({ ok: false, error: result.error }, result.status);
  const res = authResponse({ ok: true, session: result.session });
  setAuthCookiesOnResponse(res, result.session.access_token, result.session.refresh_token);
  return res;
}
