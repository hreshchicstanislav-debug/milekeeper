'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';

const PUBLIC_PATHS = new Set<string>(['/login', '/auth/callback']);

export default function AuthGate() {
  const router = useRouter();
  const pathname = usePathname();

  const supabase = useMemo(() => createBrowserClient(), []);

  useEffect(() => {
    let isMounted = true;

    const check = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!isMounted) return;

        const hasSession = !!data.session;

        // Keep server httpOnly token cookies in sync (MVP)
        if (hasSession && data.session) {
          fetch('/api/auth/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
            }),
          }).catch(() => {});
        } else {
          fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        }

        // Route protection
        const isPublic = PUBLIC_PATHS.has(pathname);
        if (!hasSession && !isPublic) {
          router.replace('/login');
        }
        if (hasSession && pathname === '/login') {
          router.replace('/');
        }
      } catch {
        // If anything goes wrong, treat as logged-out
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        if (!PUBLIC_PATHS.has(pathname)) {
          router.replace('/login');
        }
      }
    };

    check();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      if (session) {
        fetch('/api/auth/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          }),
        }).catch(() => {});
      } else {
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      }
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, [pathname, router, supabase]);

  return null;
}

