import { describe, expect, it } from 'vitest';
import type { ServiceEvent, ServiceEventKind } from '@/lib/db/types';
import {
  cursorOf, cursorSearchParams, fetchHistoryPage, parseHistoryCursor, type EventsQuery,
} from '../historyPage';
import { buildItemHistory, computeReplacementIntervals, mergeHistoryPages } from '../replacementIntervals';

/**
 * Sort key of a UTC timestamp with PostgreSQL's microsecond precision, written
 * independently of the code under test: fixed-width "YYYY-MM-DDTHH:MM:SS" + 6 fraction
 * digits compares like the instants it denotes.
 */
function pgTimestampKey(text: string): string {
  const match = /^(.{19})(?:\.(\d{1,6}))?(Z|\+00(?::?00)?)$/.exec(text);
  if (!match) throw new Error(`test data must be UTC: ${text}`);
  return match[1] + (match[2] ?? '').padEnd(6, '0');
}

/** In-memory stand-in for the PostgREST builder with the operators the route uses. */
function memoryQuery(rows: () => ServiceEvent[], calls: string[] = []): () => EventsQuery {
  const value = (row: ServiceEvent, column: string): number | string => {
    const v = (row as unknown as Record<string, string | number>)[column];
    return column === 'occurred_at' ? pgTimestampKey(String(v)) : v;
  };
  const operand = (column: string, v: string | number) => (column === 'occurred_at' ? pgTimestampKey(String(v)) : v);
  return () => {
    const filters: Array<(row: ServiceEvent) => boolean> = [];
    const orders: Array<[string, boolean]> = [];
    let limit = Infinity;
    const query: EventsQuery = {
      eq(column, v) { calls.push(`eq:${column}`); filters.push((row) => value(row, column) === operand(column, v)); return query; },
      lt(column, v) { calls.push(`lt:${column}`); filters.push((row) => value(row, column) < operand(column, v)); return query; },
      order(column, { ascending }) { orders.push([column, ascending]); return query; },
      limit(count) { limit = count; return query; },
      then(resolve, reject) {
        const data = rows().filter((row) => filters.every((f) => f(row))).sort((a, b) => {
          for (const [column, ascending] of orders) {
            const x = value(a, column), y = value(b, column);
            if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        }).slice(0, limit);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  };
}

const kinds: ServiceEventKind[] = ['replacement', 'check', 'top_up', 'check'];
/** Many records share a date and a mileage: ties must be broken by id. */
function history(count: number): ServiceEvent[] {
  return Array.from({ length: count }, (_, i) => {
    const day = 1 + Math.floor(i / 4);
    const id = `00000000-0000-4000-8000-${String(1000 + ((i * 7919) % count)).padStart(12, '0')}`;
    return {
      id, user_id: 'u', service_item_id: 'item', occurred_at: new Date(Date.UTC(2026, 0, day, 9)).toISOString(),
      mileage_km: 100000 + day * 1000, note: null, created_at: '2026-01-01T00:00:00Z',
      kind: kinds[i % kinds.length], amount_liters: kinds[i % kinds.length] === 'top_up' ? 0.5 : null,
    };
  });
}
const newestFirst = (rows: ServiceEvent[]) => mergeHistoryPages([], rows);

describe('history pagination (keyset by occurred_at, mileage_km, id)', () => {
  it('loads every record exactly once, in order, with intervals equal to the full history', async () => {
    const all = history(47);
    const base = memoryQuery(() => all);
    let loaded: ServiceEvent[] = [];
    let previous: ServiceEvent | null = null;
    let page = await fetchHistoryPage(base, null, 10);
    let pages = 1;
    for (;;) {
      loaded = mergeHistoryPages(loaded, page.events);
      previous = page.previousReplacement;
      // At every step the visible intervals equal those of the complete history.
      const expected = computeReplacementIntervals(all, { complete: true });
      for (const { event, interval } of buildItemHistory(loaded, previous)) expect(interval, event.id).toEqual(expected.get(event.id));
      if (!page.hasMore) break;
      page = await fetchHistoryPage(base, cursorOf(loaded.at(-1)!), 10);
      pages++;
    }
    expect(pages).toBe(5);
    expect(loaded.map((e) => e.id)).toEqual(newestFirst(all).map((e) => e.id));
    expect(new Set(loaded.map((e) => e.id)).size).toBe(47);
    expect(previous).toBeNull();
  });

  it('does not skip or repeat older records when the history changes between pages', async () => {
    let all = history(25);
    const base = memoryQuery(() => all);
    const first = await fetchHistoryPage(base, null, 10);
    // Meanwhile: a newer record is added and a loaded one is deleted.
    all = [...all.filter((e) => e.id !== first.events[3].id), { ...all[0], id: '00000000-0000-4000-8000-999999999999', occurred_at: '2027-01-01T00:00:00.000Z' }];
    const loaded = first.events.filter((e) => e.id !== first.events[3].id);
    const second = await fetchHistoryPage(base, cursorOf(loaded.at(-1)!), 10);
    const third = await fetchHistoryPage(base, cursorOf(second.events.at(-1)!), 10);
    const older = newestFirst(history(25)).slice(10).map((e) => e.id);
    expect([...second.events, ...third.events].map((e) => e.id)).toEqual(older);
    expect(third.hasMore).toBe(false);
  });

  it('finds the previous replacement behind more checks and top-ups than a page holds', async () => {
    const replacement = (id: string, day: number, km: number): ServiceEvent => ({
      id, user_id: 'u', service_item_id: 'item', occurred_at: new Date(Date.UTC(2026, 0, day)).toISOString(),
      mileage_km: km, note: null, created_at: '', kind: 'replacement', amount_liters: null,
    });
    const checks = Array.from({ length: 25 }, (_, i) => ({ ...replacement(`00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, 2 + i, 101000 + i), kind: 'check' as const }));
    const all = [replacement('00000000-0000-4000-8000-000000000001', 1, 100000), ...checks, replacement('00000000-0000-4000-8000-000000000099', 40, 110000)];
    const page = await fetchHistoryPage(memoryQuery(() => all), null, 10);
    expect(page.events[0].kind).toBe('replacement');
    expect(page.previousReplacement?.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(buildItemHistory(page.events, page.previousReplacement)[0].interval).toEqual({ kind: 'interval', km: 10000 });
  });

  it('queries the cursor as three simple filters (no PostgREST logic tree)', async () => {
    const calls: string[] = [];
    const all = history(5);
    await fetchHistoryPage(memoryQuery(() => all, calls), cursorOf(newestFirst(all)[1]), 10);
    expect(calls).toEqual(expect.arrayContaining(['lt:occurred_at', 'eq:occurred_at', 'lt:mileage_km', 'eq:mileage_km', 'lt:id', 'eq:kind']));
  });
});

/**
 * Rows a few microseconds apart, as PostgREST returns them (trailing zeros trimmed).
 * `Date.parse` sees one millisecond for all of them, so a millisecond comparison falls
 * back to the mileage and reverses the database order.
 */
describe('microsecond timestamps (PostgreSQL precision)', () => {
  const row = (letter: string, occurred_at: string, mileage_km: number, kind: ServiceEventKind = 'check'): ServiceEvent => ({
    id: `00000000-0000-4000-8000-00000000000${letter}`, user_id: 'u', service_item_id: 'item', occurred_at,
    mileage_km, note: null, created_at: '', kind, amount_liters: null,
  });
  // Database order (occurred_at DESC): A, B, C. Same rows as supabase/tests/service_event_kinds.sql.
  const A = row('a', '2030-07-01T09:00:00.1239+00:00', 1000);
  const B = row('b', '2030-07-01T09:00:00.1238+00:00', 2000);
  const C = row('c', '2030-07-01T09:00:00.1237+00:00', 3000);

  it('pages of two return A, B then C — nothing skipped or repeated', async () => {
    const base = memoryQuery(() => [C, A, B]);
    const first = await fetchHistoryPage(base, null, 2);
    expect(first.events.map((e) => e.id)).toEqual([A.id, B.id]);
    expect(first.hasMore).toBe(true);
    const second = await fetchHistoryPage(base, cursorOf(first.events.at(-1)!), 2);
    expect(second.events.map((e) => e.id)).toEqual([C.id]);
    expect(second.hasMore).toBe(false);
    expect(mergeHistoryPages(first.events, second.events).map((e) => e.id)).toEqual([A.id, B.id, C.id]);
  });

  it('pages of one walk the same order', async () => {
    const base = memoryQuery(() => [B, C, A]);
    const seen: string[] = [];
    let page = await fetchHistoryPage(base, null, 1);
    for (;;) {
      seen.push(...page.events.map((e) => e.id));
      if (!page.hasMore) break;
      page = await fetchHistoryPage(base, cursorOf(page.events.at(-1)!), 1);
    }
    expect(seen).toEqual([A.id, B.id, C.id]);
  });

  it('merging and re-sorting keeps the database order, whatever the input order', () => {
    expect(mergeHistoryPages([C], [B, A]).map((e) => e.id)).toEqual([A.id, B.id, C.id]);
    expect(mergeHistoryPages([], [B, C, A]).map((e) => e.id)).toEqual([A.id, B.id, C.id]);
  });

  it('intervals between replacements follow the microsecond order, also across pages', async () => {
    // Real order X → Y → Z; Y's mileage was mistyped. By millisecond + mileage the
    // order would be X → Z → Y and both intervals would be 1000 km.
    const X = row('1', '2030-07-01T09:00:00.1237+00:00', 1000, 'replacement');
    const Y = row('2', '2030-07-01T09:00:00.1238+00:00', 3000, 'replacement');
    const Z = row('3', '2030-07-01T09:00:00.1239+00:00', 2000, 'replacement');
    const expected = { [X.id]: { kind: 'first' }, [Y.id]: { kind: 'interval', km: 2000 }, [Z.id]: { kind: 'decreased' } };

    const whole = computeReplacementIntervals([Z, X, Y], { complete: true });
    for (const e of [X, Y, Z]) expect(whole.get(e.id), e.id).toEqual(expected[e.id]);

    const base = memoryQuery(() => [X, Y, Z]);
    let loaded: ServiceEvent[] = [];
    let page = await fetchHistoryPage(base, null, 1);
    for (;;) {
      loaded = mergeHistoryPages(loaded, page.events);
      for (const { event, interval } of buildItemHistory(loaded, page.previousReplacement)) {
        expect(interval, `${event.id} after ${loaded.length} loaded`).toEqual(expected[event.id]);
      }
      if (!page.hasMore) break;
      page = await fetchHistoryPage(base, cursorOf(loaded.at(-1)!), 1);
    }
    expect(loaded.map((e) => e.id)).toEqual([Z.id, Y.id, X.id]);
  });

  it('equal instants in different notations tie, and are then ordered by mileage and id', () => {
    const p = row('d', '2030-07-01T09:00:00.1239+00:00', 1000);
    const q = row('e', '2030-07-01T14:00:00.123900+05:00', 1000);
    const r = row('f', '2030-07-01T09:00:00.1239Z', 1000);
    expect(mergeHistoryPages([], [p, r, q]).map((e) => e.id)).toEqual([r.id, q.id, p.id]);
  });
});

describe('cursor parameters', () => {
  const event = { occurred_at: '2026-07-01T09:00:00.123456+00:00', mileage_km: 112000, id: '00000000-0000-4000-8000-000000000010' };

  it('round-trips the exact database timestamp', () => {
    const params = new URLSearchParams(cursorSearchParams(cursorOf(event)));
    expect(parseHistoryCursor(params)).toEqual({ ok: true, cursor: { occurredAt: event.occurred_at, mileageKm: 112000, id: event.id } });
  });

  it('accepts no cursor and rejects partial or malformed ones', () => {
    expect(parseHistoryCursor(new URLSearchParams())).toEqual({ ok: true, cursor: null });
    for (const query of [
      'beforeAt=2026-07-01T09:00:00Z',
      'beforeAt=2026-07-01T09:00:00Z&beforeKm=1&beforeId=not-a-uuid',
      'beforeAt=yesterday&beforeKm=1&beforeId=00000000-0000-4000-8000-000000000010',
      'beforeAt=2026-07-01T09:00:00Z,id.gt.0&beforeKm=1&beforeId=00000000-0000-4000-8000-000000000010',
      'beforeAt=2026-07-01T09:00:00Z&beforeKm=-1&beforeId=00000000-0000-4000-8000-000000000010',
      'beforeAt=2026-07-01T09:00:00Z&beforeKm=1.5&beforeId=00000000-0000-4000-8000-000000000010',
    ]) expect(parseHistoryCursor(new URLSearchParams(query)), query).toEqual({ ok: false });
  });
});
