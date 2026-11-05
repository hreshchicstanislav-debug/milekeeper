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

/** ISO 8601 / PostgreSQL `timestamptz` text: date, time, any fraction, explicit offset. */
const NANOS_PER_MS = BigInt(1_000_000);
const MS_PER_SECOND = BigInt(1000);
const TIMESTAMP_PARTS = /^(\d{4,})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)$/i;

/**
 * Exact instant of a timestamp string in nanoseconds since the epoch, or `null`.
 *
 * `Date.parse` keeps milliseconds only, while PostgreSQL stores microseconds: records a
 * few microseconds apart would compare as equal and fall back to the mileage, i.e. into
 * a different order than the database's `ORDER BY occurred_at`. Every digit of the
 * fraction is kept here. Strings without an explicit offset (never produced by the API)
 * fall back to `Date.parse`.
 */
export function timestampNanos(value: string): bigint | null {
  const match = TIMESTAMP_PARTS.exec(value);
  if (!match) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : BigInt(ms) * NANOS_PER_MS;
  }
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match;
  const date = new Date(0);
  // setUTCFullYear, unlike Date.UTC, does not map years 0–99 to 1900–1999.
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;
  let offsetSeconds = 0;
  if (zone.toUpperCase() !== 'Z') {
    const [h = '0', m = '0', s = '0'] = zone.slice(1).match(/\d{2}/g) ?? [];
    offsetSeconds = (zone[0] === '-' ? -1 : 1) * (Number(h) * 3600 + Number(m) * 60 + Number(s));
  }
  return (BigInt(ms) - BigInt(offsetSeconds) * MS_PER_SECOND) * NANOS_PER_MS + BigInt(fraction.padEnd(9, '0'));
}

/** Like PostgreSQL's `timestamptz` comparison: negative, 0 or positive. */
export function compareTimestamps(a: string, b: string): number {
  const x = timestampNanos(a);
  const y = timestampNanos(b);
  if (x === null || y === null) return 0;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Oldest first: `occurred_at ASC, mileage_km ASC, id ASC` (stable for equal timestamps).
 * The exact reverse of the API order `occurred_at DESC, mileage_km DESC, id DESC`,
 * including microseconds (see `timestampNanos`) and the uuid order of PostgreSQL.
 */
export function compareOldestFirst(a: HistoryEvent, b: HistoryEvent): number {
  const delta = compareTimestamps(a.occurred_at, b.occurred_at);
  if (delta !== 0) return delta;
  if (a.mileage_km !== b.mileage_km) return a.mileage_km - b.mileage_km;
  const x = a.id.toLowerCase();
  const y = b.id.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
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
