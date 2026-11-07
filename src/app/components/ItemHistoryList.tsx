'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useCopy } from '@/lib/i18n/client';
import { LocalDateTime } from '@/app/components/LocalDateTime';
import type { ServiceEvent } from '@/lib/db/types';
import { buildItemHistory, type ReplacementInterval } from '@/lib/service/replacementIntervals';
import { deleteServiceEvent } from '@/lib/actions/serviceActions';
import { isReplacementEvent } from '@/lib/service/serviceEventKinds';
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
 * What deleting a replacement does to the forecast, derived from the loaded history
 * (the loaded records are always the newest prefix, `previousReplacement` is exact):
 * - `latest`: the newest replacement goes, the forecast moves to the previous one;
 * - `older`: a newer replacement exists, the forecast stays and only intervals change;
 * - `only`: no other replacement exists, the item goes back to "mark the first replacement".
 */
type ReplacementImpact = 'latest' | 'older' | 'only';

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
  const confirmRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLUListElement>(null);
  // Only a user action moves focus; the first render with nothing open must not.
  const focusConfirmFor = useRef<string | null>(null);

  // Opening the confirmation brings it into view (clear of the sticky bottom bar, see
  // `scroll-margin-bottom` in CSS) and puts keyboard focus on the safe choice, "Cancel".
  useEffect(() => {
    if (confirmingId === null || focusConfirmFor.current !== confirmingId) return;
    focusConfirmFor.current = null;
    cancelRef.current?.focus({ preventScroll: true });
    confirmRef.current?.scrollIntoView?.({ block: 'nearest' });
    // On a short screen the whole confirmation can be taller than the scrollable area:
    // the buttons are what must be reachable, so bring them in as well.
    actionsRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [confirmingId]);

  const closeConfirm = (eventId: string, restoreFocus: boolean) => {
    setConfirmingId(null);
    setDeleteError(null);
    if (restoreFocus) triggerRefs.current.get(eventId)?.focus();
  };

  const impactOf = (index: number, interval: ReplacementInterval): ReplacementImpact | null => {
    if (!isReplacementEvent(rows[index].event)) return null;
    if (rows.findIndex((row) => isReplacementEvent(row.event)) !== index) return 'older';
    return interval.kind === 'first' ? 'only' : 'latest';
  };

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

  const handleDelete = async (event: ServiceEvent, impact: ReplacementImpact | null) => {
    setDeletingId(event.id);
    setDeleteError(null);
    try {
      const result = await deleteServiceEvent(event.id);
      setConfirmingId(null);
      if (result.ok) {
        toast.success({
          title: impact === 'latest'
            ? RU.items.history.deletedReplacement
            : impact === 'only' ? RU.items.history.deletedOnlyReplacement : RU.items.history.deleted,
          durationMs: 2500,
        });
        onDeleted(event, 'deleted');
        // The row is gone: keep keyboard focus in the list instead of losing it to the page.
        listRef.current?.focus({ preventScroll: true });
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
      <ul className="item-history-list" ref={listRef} tabIndex={-1}>
        {rows.map(({ event, interval }, index) => {
          const impact = impactOf(index, interval);
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
                  ref={(node) => { if (node) triggerRefs.current.set(event.id, node); else triggerRefs.current.delete(event.id); }}
                  onClick={() => {
                    setDeleteError(null);
                    if (!confirming) focusConfirmFor.current = event.id;
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
                <div
                  ref={confirmRef}
                  className="item-history-confirm"
                  role="alertdialog"
                  aria-labelledby={titleId}
                  aria-describedby={`${titleId}-text`}
                  onKeyDown={(keyEvent) => {
                    // Escape closes only this confirmation, not the sheet around it.
                    if (keyEvent.key !== 'Escape') return;
                    keyEvent.preventDefault();
                    keyEvent.stopPropagation();
                    if (!deleting) closeConfirm(event.id, true);
                  }}
                >
                  <p id={titleId} className="item-history-confirm-title">{RU.items.history.confirmTitle}</p>
                  <div id={`${titleId}-text`}>
                    <p className="item-history-confirm-text">{RU.items.history.confirmText}</p>
                    {impact && (
                      <p className="item-history-confirm-warning" data-testid="delete-replacement-warning" data-impact={impact}>
                        {impact === 'latest'
                          ? RU.items.history.confirmReplacementWarning
                          : impact === 'older'
                            ? RU.items.history.confirmReplacementOlder
                            : RU.items.history.confirmReplacementOnly}
                      </p>
                    )}
                  </div>
                  {deleteError && <p className="item-history-confirm-error" role="alert">{deleteError}</p>}
                  <div className="item-history-confirm-actions" ref={actionsRef}>
                    <button
                      type="button"
                      ref={cancelRef}
                      className="btn btn-secondary"
                      onClick={() => closeConfirm(event.id, true)}
                      disabled={deleting}
                    >
                      {RU.items.history.cancel}
                    </button>
                    <button
                      type="button"
                      className="btn item-history-confirm-delete"
                      onClick={() => handleDelete(event, impact)}
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
