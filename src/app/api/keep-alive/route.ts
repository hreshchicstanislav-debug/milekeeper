import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/adminClient';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
