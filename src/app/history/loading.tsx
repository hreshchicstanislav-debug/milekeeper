import { RU } from '@/lib/copy/ru';

/**
 * Instant loading state for the odometer history list.
 * Mirrors `.history-list-group` / `.history-row` so rows do not shift when data lands.
 */
export default function HistoryLoading() {
  return (
    <>
      <header className="page-header">
        <h1>{RU.history.title}</h1>
      </header>
      <div className="page-content" aria-busy="true" aria-live="polite">
        <div className="skeleton-group">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-block" style={{ height: '1rem', width: '40%' }} />
              <div className="skeleton-block" style={{ height: '0.8125rem', width: '60%' }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
