import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { COOKIE_AT, COOKIE_RT } from './authTokenCookies';

function getEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) env var.');
  }
  if (!anonKey) {
    throw new Error('Missing SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) env var.');
  }
  return { url, anonKey };
}

export async function createRlsServerClient() {
  const { url, anonKey } = getEnv();
  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const c = await cookies();
  const accessToken = c.get(COOKIE_AT)?.value ?? null;
  const refreshToken = c.get(COOKIE_RT)?.value ?? null;

  if (accessToken && refreshToken) {
    // Attach session to ensure auth.uid() is available for RLS.
    await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  }

  return supabase;
}

export async function requireCurrentUserId() {
  const { userId } = await getRlsClientAndUserId();
  return userId;
}

export async function getRlsClientAndUserId() {
  const supabase = await createRlsServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('Not authenticated');
  }
  return { supabase, userId: data.user.id };
}

