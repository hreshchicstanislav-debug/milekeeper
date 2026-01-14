'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';

export default function LoginPageClient() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const supabase = useMemo(() => {
    try {
      return createBrowserClient();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleLogin = async () => {
    setLocalError(null);
    setIsLoading(true);

    try {
      if (!supabase) {
        throw new Error('Supabase client is not configured.');
      }

      // redirectTo: prefer current origin to avoid hardcoding domains/ports
      const redirectTo = `${window.location.origin}/auth/callback`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
        },
      });

      if (error) {
        throw error;
      }

      // In most cases Supabase will redirect immediately.
      if (data?.url) {
        window.location.assign(data.url);
      }
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: 'var(--sp-5, 1.5rem)' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--sp-4, 1rem)' }}>Вход</h1>

      {error && (
        <div style={{ marginBottom: 'var(--sp-3, 0.75rem)', color: '#b00020' }}>
          Ошибка авторизации. Попробуйте ещё раз.
        </div>
      )}

      {localError && (
        <div style={{ marginBottom: 'var(--sp-3, 0.75rem)', color: '#b00020', whiteSpace: 'pre-wrap' }}>
          {localError}
        </div>
      )}

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={isLoading || !supabase}
        className="add-mileage-button"
        style={{ width: '100%' }}
      >
        {isLoading ? 'Открываем Google…' : 'Войти через Google'}
      </button>

      <div style={{ marginTop: 'var(--sp-4, 1rem)', fontSize: '0.875rem', color: 'rgba(0,0,0,0.6)' }}>
        После входа вы будете перенаправлены на главную страницу.
      </div>
    </div>
  );
}

