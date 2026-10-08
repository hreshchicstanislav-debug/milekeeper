'use client';

import { stripLocale } from '@/lib/i18n/routing';
import { useCopy } from '@/lib/i18n/client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';
import { getBrowserSession } from '@/lib/auth/browserSession';

const HIDDEN_PATHS = new Set<string>(['/login', '/auth/callback']);

function getBreadcrumbText(pathname: string, RU: ReturnType<typeof useCopy>['RU'], t: ReturnType<typeof useCopy>['t']): string {
  if (pathname === '/') {
    return RU.nav.home;
  }
  if (pathname === '/items') {
    return `${RU.nav.home} / ${RU.items.title}`;
  }
  if (pathname.startsWith('/items/')) {
    return `${RU.nav.home} / ${RU.items.title} / ${t("Детали")}`;
  }
  if (pathname === '/history') {
    return `${RU.nav.home} / ${RU.history.title}`;
  }
  return RU.nav.home;
}

export default function TopBreadcrumbsBar() {
  const { RU, t, path, errorMessageText } = useCopy();
  const pathname = stripLocale(usePathname());
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const [isAuthed, setIsAuthed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) return;
      setIsAuthed(!!data.session);
    };

    syncSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setIsAuthed(!!session);
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!confirmOpen || isSigningOut || logoutError) return;

    const onClickOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!confirmRef.current?.contains(event.target)) {
        setConfirmOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConfirmOpen(false);
      }
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [confirmOpen, isSigningOut, logoutError]);

  if (!pathname || HIDDEN_PATHS.has(pathname)) {
    return null;
  }

  const breadcrumbText = getBreadcrumbText(pathname, RU, t);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setLogoutError(null);
    try {
      const manager = getBrowserSession();
      if (await manager.logout()) {
        setConfirmOpen(false);
        router.replace(path('/login'));
      } else {
        setLogoutError(manager.state.message ?? t("Не удалось завершить выход. Повторите попытку."));
      }
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="top-breadcrumbs-bar" aria-label={t("Навигация")}>
      <div className="top-breadcrumbs-path">{breadcrumbText}</div>
      {(isAuthed || confirmOpen) && (
        <div className="top-breadcrumbs-logout" ref={confirmRef}>
          <button
            type="button"
            className="top-breadcrumbs-logout-trigger"
            onClick={() => setConfirmOpen((prev) => !prev)}
            disabled={isSigningOut || !!logoutError}
            aria-label={t("Выйти")}
            aria-expanded={confirmOpen}
            aria-haspopup="dialog"
          >

            {t("Выйти")}
          </button>
          {confirmOpen && (
            <div className="top-breadcrumbs-logout-confirm" role="dialog" aria-label={t("Подтверждение выхода")}>
              <div className="top-breadcrumbs-logout-confirm-title">{t("Выйти?")}</div>
              {logoutError && <div role="alert">{errorMessageText(logoutError)}</div>}
              <div className="top-breadcrumbs-logout-confirm-actions">
                <button
                  type="button"
                  className="top-breadcrumbs-confirm-cancel"
                  onClick={() => setConfirmOpen(false)}
                  disabled={isSigningOut || !!logoutError}
                >

                  {t("Отмена")}
                </button>
                <button
                  type="button"
                  className="top-breadcrumbs-confirm-exit"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                >
                  {isSigningOut ? t("Выход...") : t("Выйти")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
