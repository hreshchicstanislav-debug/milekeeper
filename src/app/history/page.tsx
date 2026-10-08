import { getCopy } from '@/lib/i18n/server';
import { listOdometerEntries } from '@/lib/actions/odometerActions';
import Link from 'next/link';
import { LocalDateTime } from '@/app/components/LocalDateTime';
import DeleteLatestMileageButton from './components/DeleteLatestMileageButton';
import EditLatestMileageButton from './components/EditLatestMileageButton';

/**
 * Pick the latest entry from an already-loaded list.
 *
 * Reproduces exactly what `getLatestOdometerEntry()` asked the database for —
 * `ORDER BY occurred_at DESC, mileage_km DESC LIMIT 1` — so the tie-break between two
 * entries sharing the same `occurred_at` stays identical. `listOdometerEntries()` only
 * orders by `occurred_at DESC`, so `entries[0]` alone would not be equivalent.
 */
function pickLatestEntry<T extends { occurred_at: string; mileage_km: number }>(
  entries: T[]
): T | null {
  if (entries.length === 0) {
    return null;
  }
  return entries.reduce((latest, entry) => {
    const delta = new Date(entry.occurred_at).getTime() - new Date(latest.occurred_at).getTime();
    if (delta > 0) return entry;
    if (delta === 0 && entry.mileage_km > latest.mileage_km) return entry;
    return latest;
  });
}

export default async function HistoryPage() {
  const { RU, formatNumber, path } = await getCopy();
  // One query instead of two: the latest entry is derived from the list we already load,
  // which removes a second round-trip to Supabase (auth + select) from this page.
  const entries = await listOdometerEntries(50);
  const latestEntry = pickLatestEntry(entries);

  return (
    <>
      <header className="page-header">
        <h1>{RU.history.title}</h1>
      </header>
      <div className="page-content">
        {entries.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-message">{RU.history.emptyMessage}</p>
            <Link href={path('/')} className="empty-state-link">
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

                  return (
                    <div key={entry.id} className={`history-row ${index === entries.length - 1 ? 'last' : ''}`}>
                      <div className="history-item-main">
                        <div className="history-mileage">
                          {formatNumber(entry.mileage_km)} {RU.common.km}
                        </div>
                        <div className="history-meta">
                          <span className="history-date">
                            <LocalDateTime iso={entry.occurred_at} />
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
