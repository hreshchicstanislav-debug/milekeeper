import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client for server-side usage with user-scoped actions.
 * Uses SUPABASE_URL and SUPABASE_ANON_KEY (NOT the service role key).
 * This client respects Row Level Security (RLS) policies.
 * 
 * Use this for server-side operations that should be scoped to the current user.
 */
export function createServerClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'Missing SUPABASE_URL environment variable. ' +
      'Please set it in your .env.local file.'
    );
  }

  if (!anonKey) {
    throw new Error(
      'Missing SUPABASE_ANON_KEY environment variable. ' +
      'Please set it in your .env.local file.'
    );
  }

  return createClient(url, anonKey);
}

