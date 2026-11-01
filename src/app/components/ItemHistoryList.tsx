'use client';

import { useMemo } from 'react';
import { useCopy } from '@/lib/i18n/client';
import { LocalDateTime } from '@/app/components/LocalDateTime';
import type { ServiceEvent } from '@/lib/db/types';
import { buildItemHistory, type ReplacementInterval } from '@/lib/service/replacementIntervals';

/**
 * Replacement history of one item, shared by the details sheet (/items) and the
 * details page (/items/[id]).
 *
 * @param events Newest first, loaded with `limit=ITEM_HISTORY_FETCH_LIMIT` — the extra
 *               record is not shown and only supplies the predecessor of the oldest row.
 */
export default function ItemHistoryList({ events }: { events: ServiceEvent[] }) {
  const { RU, formatNumber } = useCopy();
  const { rows, hasMore } = useMemo(() => buildItemHistory(events), [events]);

  const intervalText = (interval: ReplacementInterval): string | null => {
    switch (interval.kind) {
      case 'interval':
        return RU.items.intervalBetween.replace('{value}', formatNumber(interval.km));
      case 'same-mileage':
        return RU.items.intervalSameMileage;
      case 'decreased':
        return RU.items.intervalDecreased;
      default:
        return null;
    }
  };

  return (
    <>
      <ul className="item-history-list">
        {rows.map(({ event, interval }) => {
          const text = intervalText(interval);
          return (
            <li key={event.id} className="item-history-row">
              <span className="item-history-date">
                <LocalDateTime iso={event.occurred_at} />
              </span>
              <span className="item-history-mileage">
                {formatNumber(event.mileage_km)} {RU.common.km}
              </span>
              {text && (
                <span
                  className={`item-history-interval${interval.kind === 'interval' ? '' : ' item-history-interval-muted'}`}
                  data-interval={interval.kind}
                >
                  {text}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="item-history-hint">
          {RU.items.showAllHistoryHint}
        </div>
      )}
    </>
  );
}
