'use client';

import { useCopy } from '@/lib/i18n/client';

/**
 * Instant loading state for the odometer history list.
 * Mirrors `.history-list-group` / `.history-row` so rows do not shift when data lands.
 */
export default function HistoryLoading() {
  const { RU } = useCopy();
  return (
    <>
      <header className="page-header">
        <h1>{RU.history.title}</h1>
      </header>
      <div className="page-content" aria-busy="true" aria-live="polite">
        <div className="history-actions" aria-hidden="true">
          <div className="skeleton-block" style={{ height: 44, flexShrink: 0 }} />
          <div className="skeleton-block" style={{ height: 44, flexShrink: 0 }} />
        </div>
        <div className="history-list-group">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="history-row">
              <div className="history-item-main">
                <div className="skeleton-block history-mileage" style={{ height: '1.8rem', width: '10rem' }} />
                <div className="history-meta">
                  <div className="skeleton-block" style={{ height: '0.875rem', width: '7.5rem' }} />
                  <div className="skeleton-block" style={{ height: '0.8125rem', width: '4rem' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
