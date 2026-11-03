'use client';

import { useId, useMemo, useState } from 'react';
import { useCopy } from '@/lib/i18n/client';
import { LocalDateTime } from '@/app/components/LocalDateTime';
import type { ServiceEvent } from '@/lib/db/types';
import { buildItemHistory, type ReplacementInterval } from '@/lib/service/replacementIntervals';
import { deleteServiceEvent } from '@/lib/actions/serviceActions';
import { useToast } from './ToastProvider';

interface ItemHistoryListProps {
  /** All loaded records, newest first. */
  events: ServiceEvent[];
  /** Newest replacement older than the loaded records (from the latest page), or null. */
  previousReplacement: ServiceEvent | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  /** Called after a record was deleted (or turned out to be gone already). */
  onDeleted: (event: ServiceEvent, outcome: 'deleted' | 'already-deleted') => void;
}

/**
 * Service history of one item: replacements, checks and top-ups in one timeline.
 * Shared by the details sheet (/items) and the details page (/items/[id]).
 * Mileage between replacements is shown on replacements only and skips the other kinds.
 */
export default function ItemHistoryList({
  events, previousReplacement, hasMore, isLoadingMore, loadMoreFailed, onLoadMore, onDeleted,
}: ItemHistoryListProps) {
  const { RU, formatNumber } = useCopy();
  const toast = useToast();
  const rows = useMemo(() => buildItemHistory(events, previousReplacement), [events, previousReplacement]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const idPrefix = useId();

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

  const handleDelete = async (event: ServiceEvent) => {
    setDeletingId(event.id);
    setDeleteError(null);
    try {
      const result = await deleteServiceEvent(event.id);
      setConfirmingId(null);
      if (result.ok) {
        toast.success({
          title: event.kind === 'replacement' ? RU.items.history.deletedReplacement : RU.items.history.deleted,
          durationMs: 2500,
        });
        onDeleted(event, 'deleted');
      } else {
        // Gone already (another tab or device): refresh instead of reporting a failure.
        toast.success({ title: RU.items.history.alreadyDeleted, durationMs: 2500 });
        onDeleted(event, 'already-deleted');
      }
    } catch (err) {
      // Unexpected failure (session, database, network): never show server details.
      console.error('Failed to delete service event', err);
      setDeleteError(RU.items.history.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <ul className="item-history-list">
        {rows.map(({ event, interval }) => {
          const text = intervalText(interval);
          const kindLabel = RU.items.serviceEvent.kinds[event.kind] ?? RU.items.serviceEvent.kinds.replacement;
          const confirming = confirmingId === event.id;
          const deleting = deletingId === event.id;
          const titleId = `${idPrefix}-${event.id}-title`;
          const amount = event.kind === 'top_up' && event.amount_liters !== null ? Number(event.amount_liters) : null;
          return (
            <li key={event.id} className="item-history-row" data-kind={event.kind} data-event-id={event.id}>
              <div className="item-history-head">
                <span className="item-history-meta">
                <span className={`item-history-kind item-history-kind-${event.kind}`}>{kindLabel}</span>
                <span className="item-history-date">
                  <LocalDateTime iso={event.occurred_at} dateOnly />
                </span>
                <span className="item-history-mileage">
                  {formatNumber(event.mileage_km)} {RU.common.km}
                </span>
                {amount !== null && Number.isFinite(amount) && (
                  <span className="item-history-volume" data-testid="item-history-volume">
                    {RU.items.history.volume.replace('{value}', formatNumber(amount))}
                  </span>
                )}
                </span>
                <button
                  type="button"
                  className="item-history-delete"
                  aria-label={`${RU.items.history.delete}: ${kindLabel}`}
                  aria-expanded={confirming}
                  title={RU.items.history.delete}
                  disabled={deletingId !== null}
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmingId(confirming ? null : event.id);
                  }}
                >
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
              {text && (
                <span
                  className={`item-history-interval${interval.kind === 'interval' ? '' : ' item-history-interval-muted'}`}
                  data-interval={interval.kind}
                >
                  {text}
                </span>
              )}
              {event.note && <p className="item-history-note">{event.note}</p>}
              {confirming && (
                <div className="item-history-confirm" role="alertdialog" aria-labelledby={titleId} aria-describedby={`${titleId}-text`}>
                  <p id={titleId} className="item-history-confirm-title">{RU.items.history.confirmTitle}</p>
                  <div id={`${titleId}-text`}>
                    <p className="item-history-confirm-text">{RU.items.history.confirmText}</p>
                    {event.kind === 'replacement' && (
                      <p className="item-history-confirm-warning" data-testid="delete-replacement-warning">
                        {RU.items.history.confirmReplacementWarning}
                      </p>
                    )}
                  </div>
                  {deleteError && <p className="item-history-confirm-error" role="alert">{deleteError}</p>}
                  <div className="item-history-confirm-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => { setConfirmingId(null); setDeleteError(null); }}
                      disabled={deleting}
                    >
                      {RU.items.history.cancel}
                    </button>
                    <button
                      type="button"
                      className="btn item-history-confirm-delete"
                      onClick={() => handleDelete(event)}
                      disabled={deleting}
                    >
                      {deleting ? RU.items.history.deleting : RU.items.history.confirm}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="item-history-more">
          {loadMoreFailed && (
            <p className="item-history-error item-history-more-error" role="alert">{RU.items.history.loadMoreFailed}</p>
          )}
          <button
            type="button"
            className="btn btn-secondary item-history-more-button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? RU.items.history.loadingMore : RU.items.history.showMore}
          </button>
        </div>
      )}
    </>
  );
}
