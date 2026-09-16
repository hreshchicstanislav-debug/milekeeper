/**
 * Neutral loading state for /login.
 *
 * Without this file the root `app/loading.tsx` would be the nearest Suspense boundary
 * for this segment, so signing out (`router.replace('/login')`) would briefly flash the
 * Home skeleton — including its "Главная" heading — on the way to the login screen.
 */
export default function LoginLoading() {
  return (
    <div className="page-content" aria-busy="true" aria-live="polite">
      <div className="skeleton-stack">
        <div className="skeleton-block" style={{ height: '1.75rem', width: '55%' }} />
        <div className="skeleton-block" style={{ height: '0.9375rem', width: '80%' }} />
        <div className="skeleton-block" style={{ height: '52px', borderRadius: 'var(--control-radius, 12px)' }} />
      </div>
    </div>
  );
}
