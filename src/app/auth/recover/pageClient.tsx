'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBrowserSession, type BrowserAuthState } from '@/lib/auth/browserSession';
import { recoveryPath } from '@/lib/auth/recoveryPath';
import { localizedPath, localeFromPath } from '@/lib/i18n/routing';
import { useCopy } from '@/lib/i18n/client';

export default function RecoveryClient() {
  const { t, locale, errorMessageText, path } = useCopy();
  const router = useRouter();
  const params = useSearchParams();
  const destination = recoveryPath(params.get('next'), locale);
  const [state, setState] = useState<BrowserAuthState>({ phase: 'unknown' });
  useEffect(() => {
    const manager = getBrowserSession();
    let active = true, started = false, navigated = false;
    const navigate = (target: string) => {
      if (!active || navigated) return;
      navigated = true; router.replace(target);
    };
    const unsubscribe = manager.subscribe(next => {
      setState(next);
      if (next.phase === 'syncing') started = true;
      // Ignore the initial subscription snapshot. Accept a newly confirmed
      // flight even if a newer SDK pair superseded the first request.
      if (!started || navigated) return;
      if (next.phase === 'authed' && next.cookiesVerified) {
        navigate(destination);
      } else if (next.sessionMissing) {
        navigate(localizedPath('/login', localeFromPath(destination)));
      }
    });
    // One shared flight, including StrictMode. No automatic retry effect.
    // A previously confirmed SDK session cannot permit navigation until this
    // recovery has confirmed the cookies again (they may have been lost).
    void manager.synchronize(true).then(ok => {
      if (ok) navigate(destination);
    });
    return () => { active = false; unsubscribe(); };
  }, [destination, router]);
  const busy = state.phase === 'unknown' || state.phase === 'syncing' || state.phase === 'authed';
  return <div style={{ padding: 'var(--sp-5, 1.5rem)' }}>
    <h1>{t('Восстанавливаем сессию…')}</h1>
    {busy ? <p role="status">{t('Пожалуйста, подождите.')}</p> : <>
      <p role="alert">{state.message ? errorMessageText(state.message) : t('Сессия входа отсутствует. Повторите вход.')}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem' }}>
        <button className="btn-secondary" type="button" onClick={() => void getBrowserSession().synchronize(true)}>{t('Повторить')}</button>
        <a className="btn-primary" style={{ textDecoration: 'none' }} href={`${path('/login')}?reauth=1`}>{t('Войти через Google')}</a>
      </div>
    </>}
  </div>;
}
