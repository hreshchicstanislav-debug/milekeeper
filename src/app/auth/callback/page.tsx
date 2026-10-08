import { getCopy } from '@/lib/i18n/server';
import { Suspense } from 'react';
import AuthCallbackClient from './pageClient';

export const dynamic = 'force-dynamic';

export default async function AuthCallbackPage() {
  const { t } = await getCopy();
  // Next.js requires useSearchParams() to be inside a Suspense boundary.
  return (
    <Suspense
      fallback={
        <div style={{ padding: 'var(--sp-5, 1.5rem)', color: 'rgba(0,0,0,0.6)' }}>

          {t("Завершаем вход…")}
        </div>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}

