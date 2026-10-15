import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/adminClient';

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Without a configured
 * secret the expected value would be the literal "Bearer undefined", which any
 * caller can send, so a missing or blank secret must refuse every request.
 */
function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim()) {
    console.error('[keep-alive] CRON_SECRET is not configured; refusing request');
    return false;
  }
  const header = request.headers.get('authorization');
  if (!header) return false;
  // Equal-length digests let timingSafeEqual compare without leaking the length.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { error: insertError } = await supabase
    .from('keep_alive_pings')
    .insert({ pinged_at: new Date().toISOString() });

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('keep_alive_pings').delete().lt('pinged_at', cutoff);

  return NextResponse.json({ ok: true, pinged_at: new Date().toISOString() });
}
