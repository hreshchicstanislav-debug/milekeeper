import { RU } from '@/lib/copy/ru';

/**
 * Instant loading state for the service items list.
 * Mirrors the `.items-list-group` / `.service-item-row` layout so the real list
 * lands in the same place without a jump.
 */
export default function ItemsLoading() {
  return (
    <>
      <header className="page-header">
        <h1>{RU.items.title}</h1>
      </header>
      <div className="page-content" aria-busy="true" aria-live="polite">
        <div className="skeleton-group">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-block" style={{ height: '1rem', width: '55%' }} />
              <div className="skeleton-block" style={{ height: '0.8125rem', width: '35%' }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
