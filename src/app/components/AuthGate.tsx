'use client';

import { useCopy } from '@/lib/i18n/client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';
import { authRedirect, getBrowserSession, type BrowserAuthState } from '@/lib/auth/browserSession';

export default function AuthGate() {
  const { t, path, errorMessageText } = useCopy();
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const lastRedirect = useRef<{ pathname: string; destination: string } | null>(null);
  pathRef.current = pathname;
  const supabase = useMemo(() => createBrowserClient(), []);
  const [state, setState] = useState<BrowserAuthState>({ phase: 'unknown' });
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const manager = getBrowserSession();
    const unsubscribe = manager.subscribe(setState);
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // Auth JS holds a storage lock while notifying subscribers. SDK calls
      // must run after this callback returns. Callback page owns OAuth completion.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (pathRef.current === '/auth/callback' || pathRef.current === '/auth/recover' ||
            new URLSearchParams(window.location.search).get('reauth') === '1') return;
        void (event === 'SIGNED_OUT' ? manager.signedOut() : manager.synchronize());
      }, 0);
      timers.add(timer);
    });
    // iOS can freeze a tab/PWA for hours. Check SDK storage after resuming;
    // do not retry a failed recovery repeatedly on focus/online events.
    const resume = () => {
      if (document.visibilityState === 'hidden' || manager.state.phase !== 'authed') return;
      void manager.synchronize();
    };
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      timers.forEach(clearTimeout);
      unsubscribe();
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (pathname === '/auth/recover' || new URLSearchParams(window.location.search).get('reauth') === '1') return;
    const destination = authRedirect(state, pathname,
      process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_GUEST_MODE === '1');
    if (lastRedirect.current?.pathname !== pathname) lastRedirect.current = null;
    if (destination && lastRedirect.current?.destination !== destination) {
      lastRedirect.current = { pathname, destination };
      router.replace(destination);
    }
  }, [state, pathname, router]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [state.phase, pathname]);

  const loginPage = pathname === '/login' || pathname === '/en/login';
  if (!['error', 'reauth'].includes(state.phase) || pathname === '/auth/callback' ||
      pathname === '/auth/recover' || state.interactiveLogout || (loginPage && state.sessionMissing)) return null;
  const recoveryActions = <div role="alert">
      <p>{errorMessageText(state.message ?? '')}</p>
      <button className="btn-secondary" type="button" onClick={() => void (state.operation === 'logout'
        ? getBrowserSession().logout(false) : getBrowserSession().synchronize(true))}>{t("Повторить")}</button>
      {state.operation !== 'logout' && <>{' '}<a className="btn-primary" style={{ marginTop: '0.75rem', textDecoration: 'none' }} href={`${path('/login')}?reauth=1`}
        target={loginPage ? undefined : '_blank'} rel="noopener">{t("Войти через Google")}</a>
        {!loginPage && <p>{t('Войдите в той же учётной записи в новой вкладке, затем вернитесь сюда и нажмите «Повторить». Введённые данные остаются в этой вкладке.')}</p>}
      </>}
    </div>;
  // A public login must always leave its Google button interactive. Only an
  // open private app needs recovery in the top layer above unsaved forms.
  if (loginPage) return <div style={{ padding: 'var(--sp-3, 0.75rem)' }}>{recoveryActions}</div>;
  return (
    <dialog ref={dialogRef} aria-label={t('Восстанавливаем сессию…')}
      style={{ width: 'min(90vw, 32rem)', borderRadius: '1rem', border: 0,
        background: 'var(--app-bg, white)', padding: 'var(--sp-5, 1.5rem)' }}>
      {recoveryActions}
      <button className="btn-secondary" style={{ marginTop: '0.75rem' }} type="button" onClick={() => dialogRef.current?.close()}>{t('Закрыть')}</button>
    </dialog>
  );
}
