// Build-time boundary: importing this module from a Client Component fails the
// Next.js build instead of relying only on the runtime `window` check below.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * ⚠️ WARNING: ADMIN CLIENT - USE WITH EXTREME CAUTION ⚠️
 * 
 * This client uses the SERVICE_ROLE_KEY which bypasses Row Level Security (RLS).
 * It has FULL ACCESS to your Supabase database and can perform any operation.
 * 
 * ⚠️ SECURITY RULES:
 * - NEVER use this in client-side code (browser, React components, etc.)
 * - ONLY use in server-side code (API routes, server actions, edge functions)
 * - NEVER expose the service role key to the client
 * - Use this ONLY when you need to bypass RLS for administrative operations
 * - Prefer createServerClient() for user-scoped operations
 * 
 * Examples of when to use:
 * - Server-side admin operations
 * - Bulk data migrations
 * - System-level operations that need to bypass RLS
 * 
 * Examples of when NOT to use:
 * - Any client-side code
 * - User-facing API endpoints (unless absolutely necessary)
 * - Regular CRUD operations (use createServerClient instead)
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'Missing SUPABASE_URL environment variable. ' +
      'Please set it in your .env.local file.'
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY environment variable. ' +
      'Please set it in your .env.local file.'
    );
  }

  // Additional runtime check: warn if this might be running in a client context
  if (typeof window !== 'undefined') {
    throw new Error(
      'SECURITY ERROR: createAdminClient() must NEVER be called from client-side code. ' +
      'The service role key bypasses all security policies and should only be used server-side.'
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

