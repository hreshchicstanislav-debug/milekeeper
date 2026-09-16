'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';
import {
  nextSyncAction,
  postSessionLogout,
  postSessionSync,
  type SyncedState,
} from '@/lib/auth/sessionSync';

const PUBLIC_PATHS = new Set<string>(['/login', '/auth/callback']);

// Sentinel for the in-flight key. An access token is always a dotted JWT,
// so it can never collide with this.
const LOGOUT_KEY = 'logout';

type AuthState = 'unknown' | 'authed' | 'anon';

function isDevGuestEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_GUEST_MODE === '1';
}

export default function AuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const devGuestEnabled = isDevGuestEnabled();

  const supabase = useMemo(() => createBrowserClient(), []);

  const [authState, setAuthState] = useState<AuthState>('unknown');

  // Last state the *server* confirmed, advanced only on a 2xx. A dropped POST
  // therefore leaves this behind, and the next auth event retries it.
  const syncedRef = useRef<SyncedState>(null);
  const inFlightRef = useRef<string | null>(null);

  // Effect A — session subscription and cookie sync.
  //
  // Deliberately independent of `pathname`: the httpOnly cookies track the
  // Supabase session, not the current route, so a navigation is not a reason to
  // rewrite them. Previously this effect listed `pathname` as a dependency,
  // which tore down and rebuilt the subscription on every navigation and fired
  // two POSTs each time — one from the explicit check, one from the
  // INITIAL_SESSION that auth-js emits to every new subscriber.
  useEffect(() => {
    let isMounted = true;

    const reconcile = async (session: { access_token: string; refresh_token: string } | null) => {
      const action = nextSyncAction(syncedRef.current, session?.access_token);
      if (action === 'none') {
        return;
      }

      const key = action === 'logout' ? LOGOUT_KEY : session!.access_token;
      if (inFlightRef.current === key) {
        return;
      }
      inFlightRef.current = key;

      try {
        if (action === 'logout') {
          if (await postSessionLogout()) {
            syncedRef.current = { kind: 'signed-out' };
          } else {
            console.warn('[AuthGate] could not clear server auth cookies; will retry on next auth event');
          }
          return;
        }

        const ok = await postSessionSync({
          access_token: session!.access_token,
          refresh_token: session!.refresh_token,
        });
        if (ok) {
          syncedRef.current = { kind: 'session', accessToken: session!.access_token };
        } else {
          console.warn('[AuthGate] could not sync session to server cookies; will retry on next auth event');
        }
      } finally {
        if (inFlightRef.current === key) {
          inFlightRef.current = null;
        }
      }
    };

    // auth-js emits INITIAL_SESSION to every new subscriber, so this covers the
    // initial check as well as SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED /
    // SIGNED_OUT. Token-level dedupe in nextSyncAction() means only events that
    // actually change the access token reach the network.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setAuthState(session ? 'authed' : 'anon');
      void reconcile(session);
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  // Effect B — route protection only. This is the part that legitimately
  // depends on the pathname.
  useEffect(() => {
    if (authState === 'unknown') {
      return;
    }
    const isPublic = PUBLIC_PATHS.has(pathname);
    if (authState === 'anon' && !isPublic && !devGuestEnabled) {
      router.replace('/login');
    }
    if (authState === 'authed' && pathname === '/login') {
      router.replace('/');
    }
  }, [authState, pathname, router, devGuestEnabled]);

  return null;
}
