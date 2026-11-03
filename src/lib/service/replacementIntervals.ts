/**
 * Actual mileage between consecutive replacements of one maintenance item.
 *
 * Computed on the fly from the odometer readings stored in service events; never
 * persisted. Only replacements form the chain: checks and top-ups in between are
 * skipped (`isReplacementEvent`) and never break or shorten an interval.
 */

import type { ServiceEventKind } from '@/lib/db/types';
import { isReplacementEvent } from './serviceEventKinds';

export interface HistoryEvent {
  id: string;
  occurred_at: string;
  mileage_km: number;
  /** Missing kind means replacement (the database default for older rows). */
  kind?: ServiceEventKind | null;
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
  /** Defaults to `isReplacementEvent` (kind = 'replacement'). */
  isReplacement?: (event: T) => boolean;
  /**
   * `true` when `events` holds the item's entire history. When `false`, the oldest
   * loaded replacement gets `unknown` instead of `first`.
   */
  complete: boolean;
}

/**
 * Oldest first: `occurred_at ASC, mileage_km ASC, id ASC` (stable for equal timestamps).
 * The exact reverse of the API order `occurred_at DESC, mileage_km DESC, id DESC`.
 */
export function compareOldestFirst(a: HistoryEvent, b: HistoryEvent): number {
  const delta = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  if (delta !== 0 && !Number.isNaN(delta)) return delta;
  if (a.mileage_km !== b.mileage_km) return a.mileage_km - b.mileage_km;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Interval for every event, keyed by event id. Input order does not matter. */
export function computeReplacementIntervals<T extends HistoryEvent>(
  events: readonly T[],
  { isReplacement = isReplacementEvent, complete }: ReplacementIntervalOptions<T>
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

/** Records per history page; "Show more" loads the next page of older records. */
export const ITEM_HISTORY_PAGE_SIZE = 10;

export interface ItemHistoryRow<T extends HistoryEvent> {
  event: T;
  interval: ReplacementInterval;
}

/**
 * Rows for every loaded record (all loaded pages, newest first).
 *
 * @param previousReplacement The newest replacement older than the oldest loaded record,
 *        as returned with the latest page by `/api/service-events`; `null` when there is
 *        none. It is not shown, it only supplies the interval of the oldest loaded
 *        replacement — however many checks and top-ups lie in between.
 */
export function buildItemHistory<T extends HistoryEvent>(
  events: readonly T[],
  previousReplacement: HistoryEvent | null
): ItemHistoryRow<T>[] {
  const chain: HistoryEvent[] = [...events];
  if (previousReplacement && !events.some((event) => event.id === previousReplacement.id)) {
    chain.push({ ...previousReplacement, kind: 'replacement' });
  }
  // `previousReplacement` makes the chain exact: null means no older replacement exists.
  const intervals = computeReplacementIntervals(chain, { complete: true });
  return events.map((event) => ({
    event,
    interval: intervals.get(event.id) ?? { kind: 'unknown' as const },
  }));
}

/**
 * Appends an older page to the loaded records: newest first, each id once. A record
 * that is already loaded (e.g. the history changed between requests) is not duplicated.
 */
export function mergeHistoryPages<T extends HistoryEvent>(loaded: readonly T[], page: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const event of [...loaded, ...page]) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => compareOldestFirst(b, a));
}
