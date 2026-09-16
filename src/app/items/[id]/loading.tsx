/**
 * Instant loading state for a single service item.
 *
 * The item title is not known before the server responds, so this shows neutral
 * placeholders only. Kept deliberately small — the real screen replaces it as soon
 * as the server component resolves.
 */
export default function ItemDetailsLoading() {
  return (
    <div className="page-content" aria-busy="true" aria-live="polite">
      <div className="skeleton-stack">
        <div className="skeleton-block" style={{ height: '1.5rem', width: '60%' }} />

        <div className="skeleton-card">
          <div className="skeleton-block" style={{ height: '0.875rem', width: '40%' }} />
          <div className="skeleton-block" style={{ height: '1.75rem', width: '65%' }} />
        </div>

        <div className="skeleton-group">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-block" style={{ height: '0.9375rem', width: '50%' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
