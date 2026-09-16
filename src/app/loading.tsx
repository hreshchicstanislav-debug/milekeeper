import { RU } from '@/lib/copy/ru';

/**
 * Instant loading state for Home.
 *
 * The real title renders immediately so navigation feels acknowledged; only the
 * data-dependent blocks (mileage card, rate hint, upcoming list) are placeholders.
 */
export default function HomeLoading() {
  return (
    <>
      <header className="page-header">
        <h1>{RU.home.title}</h1>
      </header>
      <div className="page-content" aria-busy="true" aria-live="polite">
        <div className="skeleton-stack">
          <div className="skeleton-card">
            <div className="skeleton-block" style={{ height: '0.875rem', width: '45%' }} />
            <div className="skeleton-block" style={{ height: '2.5rem', width: '70%' }} />
            <div className="skeleton-block" style={{ height: '0.8125rem', width: '60%' }} />
          </div>

          <div className="skeleton-block" style={{ height: '0.8125rem', width: '75%' }} />

          <div className="skeleton-block" style={{ height: '52px', borderRadius: 'var(--control-radius, 12px)' }} />

          <div className="skeleton-group">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton-row">
                <div className="skeleton-block" style={{ height: '1rem', width: '55%' }} />
                <div className="skeleton-block" style={{ height: '0.8125rem', width: '35%' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
