'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';

export default function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [errorText, setErrorText] = useState<string | null>(null);

  const supabase = useMemo(() => createBrowserClient(), []);

  useEffect(() => {
    const run = async () => {
      try {
        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (error) {
          router.replace('/login?error=1');
          return;
        }

        if (!code) {
          // If no code, try existing browser session
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            await fetch('/api/auth/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
              }),
            });
            router.replace('/');
            return;
          }
          router.replace('/login?error=1');
          return;
        }

        // PKCE exchange must happen in the browser (uses stored code verifier)
        const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;

        const session = exchangeData.session;
        if (!session) {
          router.replace('/login?error=1');
          return;
        }

        await fetch('/api/auth/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          }),
        });

        router.replace('/');
      } catch (e) {
        setErrorText(e instanceof Error ? e.message : String(e));
        router.replace('/login?error=1');
      }
    };

    run();
  }, [router, searchParams, supabase]);

  return (
    <div style={{ padding: 'var(--sp-5, 1.5rem)' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: 'var(--sp-3, 0.75rem)' }}>Завершаем вход…</h1>
      {errorText && (
        <div style={{ color: '#b00020', whiteSpace: 'pre-wrap' }}>
          {errorText}
        </div>
      )}
      {!errorText && <div style={{ color: 'rgba(0,0,0,0.6)' }}>Пожалуйста, подождите.</div>}
    </div>
  );
}

