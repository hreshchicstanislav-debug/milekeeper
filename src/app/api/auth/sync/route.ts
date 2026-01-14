import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookiesOnResponse } from '@/lib/supabase/authTokenCookies';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const access_token = typeof body?.access_token === 'string' ? body.access_token : null;
    const refresh_token = typeof body?.refresh_token === 'string' ? body.refresh_token : null;

    if (!access_token || !refresh_token) {
      return NextResponse.json({ ok: false, error: 'missing tokens' }, { status: 400 });
    }

    const res = NextResponse.json({ ok: true }, { status: 200 });
    setAuthCookiesOnResponse(res, access_token, refresh_token);
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
}

