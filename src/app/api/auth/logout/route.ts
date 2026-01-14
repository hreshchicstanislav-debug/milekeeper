import { NextResponse } from 'next/server';
import { clearAuthCookiesOnResponse } from '@/lib/supabase/authTokenCookies';

export async function POST() {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  clearAuthCookiesOnResponse(res);
  return res;
}

