import { listOdometerEntries, getLatestOdometerEntry } from '@/lib/actions/odometerActions';
import Link from 'next/link';
import { RU, formatNumber } from '@/lib/copy/ru';
import { formatDateTimeRu } from '@/lib/ui/formatDateTimeRu';
import DeleteLatestMileageButton from './components/DeleteLatestMileageButton';
import EditLatestMileageButton from './components/EditLatestMileageButton';

export default async function HistoryPage() {
  const entries = await listOdometerEntries(50);
  const latestEntry = await getLatestOdometerEntry('History');

  return (
    <>
      <header className="page-header">
        <h1>{RU.history.title}</h1>
      </header>
      <div className="page-content">
        {entries.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-message">{RU.history.emptyMessage}</p>
            <Link href="/" className="empty-state-link">
              {RU.history.emptyCta}
            </Link>
          </div>
        ) : (
          <>
            <div className="history-actions">
              {latestEntry && (
                <EditLatestMileageButton latestEntry={latestEntry} />
              )}
              <DeleteLatestMileageButton />
            </div>
            <div className="history-list-group">
              <div className="history-list">
                {entries.map((entry, index) => {
                  const previousEntry = entries[index + 1];
                  const deltaKm = previousEntry
                    ? entry.mileage_km - previousEntry.mileage_km
                    : null;

                  const formattedDateTime = formatDateTimeRu(entry.occurred_at);

                  return (
                    <div key={entry.id} className={`history-row ${index === entries.length - 1 ? 'last' : ''}`}>
                      <div className="history-item-main">
                        <div className="history-mileage">
                          {formatNumber(entry.mileage_km)} {RU.common.km}
                        </div>
                        <div className="history-meta">
                          <span className="history-date">
                            {formattedDateTime}
                          </span>
                          {deltaKm !== null && (
                            <span className="history-delta">
                              +{formatNumber(deltaKm)} {RU.common.km}
                            </span>
                          )}
                        </div>
                      </div>
                      {entry.note && (
                        <div className="history-note">{entry.note}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
