'use client';

import { callbackHome, readOAuthLocale, localizedPath } from '@/lib/i18n/routing';
import { useCopy } from '@/lib/i18n/client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';
import { getBrowserSession } from '@/lib/auth/browserSession';

export default function AuthCallbackClient() {
  const { t, systemText, locale } = useCopy();
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const supabase = useMemo(() => createBrowserClient(), []);
  const completion = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setBusy(true);
      setErrorText(null);
      try {
        if (oauthError) throw new Error(t("Google не подтвердил вход. Повторите вход."));
        // One promise per callback mount: React StrictMode and manual retry must
        // never exchange the same one-use OAuth code twice. SDK initialization
        // may already have completed the URL exchange, so read that session first.
        completion.current ??= (async () => {
          const { data, error } = await supabase.auth.getSession();
          if (error) {
            completion.current = null; // getSession did not consume an OAuth code; manual retry is safe.
            throw new Error(t("Не удалось получить сессию. Повторите попытку."));
          }
          if (data.session) return;
          if (!code) throw new Error(t("Сессия входа отсутствует. Повторите вход."));
          const result = await supabase.auth.exchangeCodeForSession(code);
          if (result.error || !result.data.session) throw new Error(t("Не удалось завершить вход через Google. Повторите вход."));
        })();
        await completion.current;
        const manager = getBrowserSession();
        const ok = await manager.synchronize(true);
        if (!mounted) return;
        if (ok) router.replace(callbackHome(readOAuthLocale(locale)));
        else setErrorText(manager.state.message ?? t("Не удалось синхронизировать сессию. Повторите вход."));
      } catch (error) {
        if (mounted) setErrorText(error instanceof Error ? error.message : t("Не удалось завершить вход."));
      } finally { if (mounted) setBusy(false); }
    };
    void run();
    return () => { mounted = false; };
  }, [router, code, oauthError, supabase, attempt, locale, t]);

  return (
    <div style={{ padding: 'var(--sp-5, 1.5rem)' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: 'var(--sp-3, 0.75rem)' }}>{t("Завершаем вход…")}</h1>
      {errorText && <div role="alert" style={{ color: '#b00020', whiteSpace: 'pre-wrap' }}>{systemText(errorText)}</div>}
      {busy && <div style={{ color: 'rgba(0,0,0,0.6)' }}>{t("Пожалуйста, подождите.")}</div>}
      {errorText && !busy && <>
        <button type="button" onClick={() => setAttempt(value => value + 1)}>{t("Повторить")}</button>
        {' '}<a href={localizedPath('/login', readOAuthLocale(locale))}>{t("Вернуться ко входу")}</a>
      </>}
    </div>
  );
}
