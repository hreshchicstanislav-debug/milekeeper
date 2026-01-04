import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client for browser/client-side usage.
 * Uses NEXT_PUBLIC_ prefixed environment variables that are safe to expose to the client.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL environment variable. ' +
      'Please set it in your .env.local file.'
    );
  }

  if (!anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable. ' +
      'Please set it in your .env.local file.'
    );
  }

  return createClient(url, anonKey);
}

