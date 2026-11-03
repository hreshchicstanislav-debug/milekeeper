/**
 * Actual mileage between consecutive replacements of one maintenance item.
 *
 * Computed on the fly from the odometer readings stored in service events; never
 * persisted. The calculation does not assume that every history record is a
 * replacement: callers can pass `isReplacement` so that future record kinds
 * (inspection, top-up) are skipped and do not break the chain.
 */

export interface HistoryEvent {
  id: string;
  occurred_at: string;
  mileage_km: number;
}

export type ReplacementInterval =
  /** Positive mileage since the previous replacement. */
  | { kind: 'interval'; km: number }
  /** Recorded at the same odometer reading as the previous replacement. */
  | { kind: 'same-mileage' }
  /** Lower odometer reading than the previous (earlier) replacement — inconsistent data. */
  | { kind: 'decreased' }
  /** No earlier replacement exists. */
  | { kind: 'first' }
  /** An earlier replacement may exist but was not loaded. */
  | { kind: 'unknown' }
  /** The record is not a replacement and has no interval. */
  | { kind: 'not-replacement' };

export interface ReplacementIntervalOptions<T extends HistoryEvent> {
  /** Defaults to "every record is a replacement" (the only kind stored today). */
  isReplacement?: (event: T) => boolean;
  /**
   * `true` when `events` holds the item's entire history. When `false`, the oldest
   * loaded replacement gets `unknown` instead of `first`.
   */
  complete: boolean;
}

/** Oldest first: `occurred_at ASC, mileage_km ASC, id ASC` (stable for equal timestamps). */
function compareOldestFirst(a: HistoryEvent, b: HistoryEvent): number {
  const delta = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  if (delta !== 0 && !Number.isNaN(delta)) return delta;
  if (a.mileage_km !== b.mileage_km) return a.mileage_km - b.mileage_km;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Interval for every event, keyed by event id. Input order does not matter. */
export function computeReplacementIntervals<T extends HistoryEvent>(
  events: readonly T[],
  { isReplacement = () => true, complete }: ReplacementIntervalOptions<T>
): Map<string, ReplacementInterval> {
  const result = new Map<string, ReplacementInterval>();
  let previous: T | null = null;

  for (const event of [...events].sort(compareOldestFirst)) {
    if (!isReplacement(event)) {
      result.set(event.id, { kind: 'not-replacement' });
      continue;
    }
    if (previous === null) {
      result.set(event.id, { kind: complete ? 'first' : 'unknown' });
    } else {
      const km = event.mileage_km - previous.mileage_km;
      result.set(event.id, km > 0 ? { kind: 'interval', km } : km === 0 ? { kind: 'same-mileage' } : { kind: 'decreased' });
    }
    previous = event;
  }
  return result;
}

/** Rows shown in the item history. */
export const ITEM_HISTORY_VISIBLE_LIMIT = 10;
/**
 * Rows requested from `/api/service-events`: one more than shown, so the oldest visible
 * replacement still has its predecessor (if there is one) and we know whether older
 * records exist.
 */
export const ITEM_HISTORY_FETCH_LIMIT = ITEM_HISTORY_VISIBLE_LIMIT + 1;

export interface ItemHistoryRow<T extends HistoryEvent> {
  event: T;
  interval: ReplacementInterval;
}

/**
 * @param events Newest first, as returned by `/api/service-events` with
 *               `limit=ITEM_HISTORY_FETCH_LIMIT`.
 */
export function buildItemHistory<T extends HistoryEvent>(
  events: readonly T[],
  options: { isReplacement?: (event: T) => boolean } = {}
): { rows: ItemHistoryRow<T>[]; hasMore: boolean } {
  const hasMore = events.length > ITEM_HISTORY_VISIBLE_LIMIT;
  const intervals = computeReplacementIntervals(events, {
    isReplacement: options.isReplacement,
    complete: events.length < ITEM_HISTORY_FETCH_LIMIT,
  });
  const rows = events.slice(0, ITEM_HISTORY_VISIBLE_LIMIT).map((event) => ({
    event,
    interval: intervals.get(event.id) ?? { kind: 'unknown' as const },
  }));
  return { rows, hasMore };
}
