import { Suspense } from 'react';
import AuthCallbackClient from './pageClient';

export const dynamic = 'force-dynamic';

export default function AuthCallbackPage() {
  // Next.js requires useSearchParams() to be inside a Suspense boundary.
  return (
    <Suspense
      fallback={
        <div style={{ padding: 'var(--sp-5, 1.5rem)', color: 'rgba(0,0,0,0.6)' }}>
          Завершаем вход…
        </div>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}

