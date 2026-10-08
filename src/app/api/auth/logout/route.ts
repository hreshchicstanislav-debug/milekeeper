import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookiesOnResponse } from '@/lib/supabase/authTokenCookies';
import { authResponse, readAuthRequest } from '@/lib/auth/authRequest';

export async function POST(req: NextRequest) {
  const body = await readAuthRequest(req);
  if (body instanceof NextResponse) return body;
  if (Object.keys(body).length) return authResponse({ ok: false, error: 'bad request' }, 400);
  const res = authResponse({ ok: true });
  clearAuthCookiesOnResponse(res);
  return res;
}
