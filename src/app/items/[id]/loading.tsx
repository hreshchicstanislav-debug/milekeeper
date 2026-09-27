/** Keep the same flex shell and action rail while service data loads. */
export default function ItemDetailsLoading() {
  return (
    <div className="item-details-page-route" aria-busy="true" aria-label="Загрузка элемента">
      <div className="item-details-page">
        <div className="item-details-page-shell">
          <div className="item-details-page-scroll">
            <div className="item-details-page-header">
              <div className="item-details-page-header-row" aria-hidden="true">
                <div className="skeleton-block" style={{ width: 44, height: 44, flexShrink: 0 }} />
                <div className="item-details-page-title-wrapper skeleton-stack">
                  <div className="skeleton-block" style={{ height: '2.1rem', width: '85%' }} />
                  <div className="skeleton-block" style={{ height: '0.8125rem', width: '65%' }} />
                </div>
              </div>
              <div className="details-tabs" aria-hidden="true">
                <div className="skeleton-block" style={{ height: 44, flex: 1 }} />
                <div className="skeleton-block" style={{ height: 44, flex: 1 }} />
              </div>
            </div>
            <div className="item-details-page-body" aria-hidden="true">
              <div className="skeleton-group">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton-row">
                    <div className="skeleton-block" style={{ height: '0.875rem', width: '50%' }} />
                    <div className="skeleton-block" style={{ height: '1.5rem', width: '65%' }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="item-details-page-footer" aria-hidden="true">
            <div className="skeleton-block" style={{ height: 44, flex: 1 }} />
            <div className="skeleton-block" style={{ height: 44, flex: 1 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
