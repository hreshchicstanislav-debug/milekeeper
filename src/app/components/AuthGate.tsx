'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';
import { authRedirect, getBrowserSession, type BrowserAuthState } from '@/lib/auth/browserSession';

export default function AuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const lastRedirect = useRef<{ pathname: string; destination: string } | null>(null);
  pathRef.current = pathname;
  const supabase = useMemo(() => createBrowserClient(), []);
  const [state, setState] = useState<BrowserAuthState>({ phase: 'unknown' });

  useEffect(() => {
    const manager = getBrowserSession();
    const unsubscribe = manager.subscribe(setState);
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // Auth JS holds a storage lock while notifying subscribers. SDK calls
      // must run after this callback returns. Callback page owns OAuth completion.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (pathRef.current === '/auth/callback') return;
        void (event === 'SIGNED_OUT' ? manager.signedOut() : manager.synchronize());
      }, 0);
      timers.add(timer);
    });
    return () => {
      timers.forEach(clearTimeout);
      unsubscribe();
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const destination = authRedirect(state, pathname,
      process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_GUEST_MODE === '1');
    if (lastRedirect.current?.pathname !== pathname) lastRedirect.current = null;
    if (destination && lastRedirect.current?.destination !== destination) {
      lastRedirect.current = { pathname, destination };
      router.replace(destination);
    }
  }, [state, pathname, router]);

  if (state.phase !== 'error' || pathname === '/auth/callback' || state.interactiveLogout) return null;
  return (
    <div role="alert" style={{ padding: 'var(--sp-3, 0.75rem)' }}>
      <p>{state.message}</p>
      <button type="button" onClick={() => void (state.operation === 'logout'
        ? getBrowserSession().logout(false) : getBrowserSession().synchronize(true))}>Повторить</button>
      {state.operation !== 'logout' && <>{' '}<a href="/login">Войти через Google</a></>}
    </div>
  );
}
