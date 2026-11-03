import type { ServiceEvent } from '@/lib/db/types';
import { compareOldestFirst } from './replacementIntervals';

/**
 * Keyset pagination of an item's history in the total order
 * `occurred_at DESC, mileage_km DESC, id DESC`. The id makes the order strict, so
 * records with the same date and mileage are neither skipped nor repeated between
 * pages, and records added or deleted meanwhile do not shift later pages.
 */
export interface HistoryCursor {
  /** `occurred_at` exactly as returned by the API (full database precision). */
  occurredAt: string;
  mileageKm: number;
  id: string;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

export function cursorOf(event: Pick<ServiceEvent, 'occurred_at' | 'mileage_km' | 'id'>): HistoryCursor {
  return { occurredAt: event.occurred_at, mileageKm: event.mileage_km, id: event.id };
}

/** Strictly validated: the values are passed on as PostgREST filter values. */
export function parseHistoryCursor(params: URLSearchParams): { ok: true; cursor: HistoryCursor | null } | { ok: false } {
  const occurredAt = params.get('beforeAt');
  const mileage = params.get('beforeKm');
  const id = params.get('beforeId');
  if (occurredAt === null && mileage === null && id === null) return { ok: true, cursor: null };
  if (
    occurredAt === null || mileage === null || id === null ||
    !TIMESTAMP_PATTERN.test(occurredAt) || Number.isNaN(Date.parse(occurredAt)) ||
    !/^\d{1,9}$/.test(mileage) || !UUID_PATTERN.test(id)
  ) {
    return { ok: false };
  }
  return { ok: true, cursor: { occurredAt, mileageKm: Number(mileage), id } };
}

export function cursorSearchParams(cursor: HistoryCursor): string {
  return new URLSearchParams({ beforeAt: cursor.occurredAt, beforeKm: String(cursor.mileageKm), beforeId: cursor.id }).toString();
}

type QueryResult = { data: ServiceEvent[] | null; error: unknown };
/** The subset of the Supabase query builder used here. */
export interface EventsQuery extends PromiseLike<QueryResult> {
  eq(column: string, value: string | number): EventsQuery;
  lt(column: string, value: string | number): EventsQuery;
  order(column: string, options: { ascending: boolean }): EventsQuery;
  limit(count: number): EventsQuery;
}

export class HistoryQueryError extends Error {
  constructor() { super('Failed to load service history'); }
}

const newestFirst = (a: ServiceEvent, b: ServiceEvent) => compareOldestFirst(b, a);

/**
 * Up to `limit` records strictly before `cursor` (or the newest ones without a cursor).
 *
 * The row comparison `(occurred_at, mileage_km, id) < cursor` is split into three simple
 * filters instead of one PostgREST `or=(...)` expression, so a timestamp never needs
 * quoting inside a logic tree. Each part is limited, the union is re-sorted and cut.
 *
 * @param base Returns a new, already user- and item-scoped query on each call.
 */
export async function fetchEventsBefore(
  base: () => EventsQuery,
  cursor: HistoryCursor | null,
  limit: number
): Promise<ServiceEvent[]> {
  const ordered = (query: EventsQuery) => query
    .order('occurred_at', { ascending: false })
    .order('mileage_km', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  const queries = cursor === null ? [ordered(base())] : [
    ordered(base().lt('occurred_at', cursor.occurredAt)),
    ordered(base().eq('occurred_at', cursor.occurredAt).lt('mileage_km', cursor.mileageKm)),
    ordered(base().eq('occurred_at', cursor.occurredAt).eq('mileage_km', cursor.mileageKm).lt('id', cursor.id)),
  ];
  const results = await Promise.all(queries);
  if (results.some((result) => result.error)) throw new HistoryQueryError();
  return results.flatMap((result) => result.data ?? []).sort(newestFirst).slice(0, limit);
}

export interface HistoryPage {
  events: ServiceEvent[];
  hasMore: boolean;
  /** Newest replacement older than the last record of this page, or null if none. */
  previousReplacement: ServiceEvent | null;
}

export async function fetchHistoryPage(
  base: () => EventsQuery,
  cursor: HistoryCursor | null,
  pageSize: number
): Promise<HistoryPage> {
  // One extra record tells whether an older page exists.
  const rows = await fetchEventsBefore(base, cursor, pageSize + 1);
  const events = rows.slice(0, pageSize);
  const oldest = events.at(-1);
  const previousReplacement = oldest
    ? (await fetchEventsBefore(() => base().eq('kind', 'replacement'), cursorOf(oldest), 1))[0] ?? null
    : null;
  return { events, hasMore: rows.length > pageSize, previousReplacement };
}
