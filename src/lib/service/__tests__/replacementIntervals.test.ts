import { describe, expect, it } from 'vitest';
import {
  buildItemHistory,
  computeReplacementIntervals,
  ITEM_HISTORY_FETCH_LIMIT,
  ITEM_HISTORY_VISIBLE_LIMIT,
  type HistoryEvent,
} from '../replacementIntervals';

const ev = (id: string, occurred_at: string, mileage_km: number): HistoryEvent => ({ id, occurred_at, mileage_km });

describe('computeReplacementIntervals', () => {
  it('computes mileage between consecutive replacements; the first has none', () => {
    const first = ev('1', '2026-01-10T10:00:00Z', 100000);
    const second = ev('2', '2026-06-10T10:00:00Z', 105200);
    const result = computeReplacementIntervals([second, first], { complete: true });
    expect(result.get('2')).toEqual({ kind: 'interval', km: 5200 });
    expect(result.get('1')).toEqual({ kind: 'first' });
  });

  it('orders by date, not by input order or mileage', () => {
    const events = [
      ev('c', '2026-09-01T00:00:00Z', 110000),
      ev('a', '2026-01-01T00:00:00Z', 100000),
      ev('b', '2026-05-01T00:00:00Z', 104000),
    ];
    const result = computeReplacementIntervals(events, { complete: true });
    expect(result.get('b')).toEqual({ kind: 'interval', km: 4000 });
    expect(result.get('c')).toEqual({ kind: 'interval', km: 6000 });
  });

  it('reports same mileage and decreasing mileage instead of a 0 or negative interval', () => {
    const events = [
      ev('a', '2026-01-01T00:00:00Z', 100000),
      ev('b', '2026-02-01T00:00:00Z', 100000),
      ev('c', '2026-03-01T00:00:00Z', 99000), // backdated/typo: lower than the earlier one
    ];
    const result = computeReplacementIntervals(events, { complete: true });
    expect(result.get('b')).toEqual({ kind: 'same-mileage' });
    expect(result.get('c')).toEqual({ kind: 'decreased' });
  });

  it('orders events with the same timestamp by mileage (no negative interval)', () => {
    const t = '2026-04-01T09:00:00Z';
    const result = computeReplacementIntervals([ev('hi', t, 100500), ev('lo', t, 100000)], { complete: true });
    expect(result.get('hi')).toEqual({ kind: 'interval', km: 500 });
    expect(result.get('lo')).toEqual({ kind: 'first' });
  });

  it('marks the oldest loaded replacement unknown when the history is truncated', () => {
    const result = computeReplacementIntervals([ev('a', '2026-01-01T00:00:00Z', 100000)], { complete: false });
    expect(result.get('a')).toEqual({ kind: 'unknown' });
  });

  it('skips records that are not replacements (future checks / top-ups)', () => {
    type Kinded = HistoryEvent & { kind: 'replacement' | 'check' };
    const events: Kinded[] = [
      { ...ev('r1', '2026-01-01T00:00:00Z', 100000), kind: 'replacement' },
      { ...ev('c1', '2026-03-01T00:00:00Z', 102000), kind: 'check' },
      { ...ev('r2', '2026-06-01T00:00:00Z', 105200), kind: 'replacement' },
    ];
    const result = computeReplacementIntervals(events, { complete: true, isReplacement: (e) => e.kind === 'replacement' });
    expect(result.get('r2')).toEqual({ kind: 'interval', km: 5200 });
    expect(result.get('c1')).toEqual({ kind: 'not-replacement' });
    expect(result.get('r1')).toEqual({ kind: 'first' });
  });

  it('recomputes when the history changes (e.g. a replacement is inserted in between)', () => {
    const a = ev('a', '2026-01-01T00:00:00Z', 100000);
    const c = ev('c', '2026-09-01T00:00:00Z', 110000);
    expect(computeReplacementIntervals([c, a], { complete: true }).get('c')).toEqual({ kind: 'interval', km: 10000 });
    const b = ev('b', '2026-05-01T00:00:00Z', 104000);
    expect(computeReplacementIntervals([c, b, a], { complete: true }).get('c')).toEqual({ kind: 'interval', km: 6000 });
  });
});

describe('buildItemHistory (API limit)', () => {
  // Newest first, like /api/service-events; 1 000 km between replacements.
  const history = (count: number) => Array.from({ length: count }, (_, i) => {
    const n = count - i; // n-th replacement
    return ev(`e${n}`, new Date(Date.UTC(2020, 0, n)).toISOString(), 100000 + n * 1000);
  });

  it('fetches exactly one record more than it shows', () => {
    expect(ITEM_HISTORY_FETCH_LIMIT).toBe(ITEM_HISTORY_VISIBLE_LIMIT + 1);
  });

  it('gives the oldest visible replacement its predecessor from the extra record', () => {
    const { rows, hasMore } = buildItemHistory(history(ITEM_HISTORY_FETCH_LIMIT));
    expect(rows).toHaveLength(ITEM_HISTORY_VISIBLE_LIMIT);
    expect(hasMore).toBe(true);
    expect(rows.map((r) => r.event.id)).not.toContain('e1');
    expect(rows.at(-1)!.event.id).toBe('e2');
    expect(rows.at(-1)!.interval).toEqual({ kind: 'interval', km: 1000 });
    expect(rows.every((r) => r.interval.kind === 'interval')).toBe(true);
  });

  it('shows "first" for the very first replacement when the whole history fits', () => {
    const { rows, hasMore } = buildItemHistory(history(ITEM_HISTORY_VISIBLE_LIMIT));
    expect(rows).toHaveLength(ITEM_HISTORY_VISIBLE_LIMIT);
    expect(hasMore).toBe(false);
    expect(rows.at(-1)!.interval).toEqual({ kind: 'first' });
  });

  it('handles empty and single-record histories', () => {
    expect(buildItemHistory([])).toEqual({ rows: [], hasMore: false });
    const { rows } = buildItemHistory(history(1));
    expect(rows[0].interval).toEqual({ kind: 'first' });
  });
});
