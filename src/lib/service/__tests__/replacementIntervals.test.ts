import { describe, expect, it } from 'vitest';
import {
  buildItemHistory,
  computeReplacementIntervals,
  mergeHistoryPages,
  type HistoryEvent,
} from '../replacementIntervals';
import type { ServiceEventKind } from '@/lib/db/types';

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

describe('kinds: checks and top-ups never count as replacements', () => {
  const k = (id: string, date: string, km: number, kind: ServiceEventKind): HistoryEvent => ({ ...ev(id, date, km), kind });

  it('skips checks and top-ups by default (kind), and treats a missing kind as replacement', () => {
    const result = computeReplacementIntervals([
      ev('legacy', '2026-01-01T00:00:00Z', 100000),
      k('t', '2026-02-01T00:00:00Z', 101000, 'top_up'),
      k('c', '2026-03-01T00:00:00Z', 102000, 'check'),
      k('r', '2026-06-01T00:00:00Z', 110000, 'replacement'),
    ], { complete: true });
    expect(result.get('legacy')).toEqual({ kind: 'first' });
    expect(result.get('t')).toEqual({ kind: 'not-replacement' });
    expect(result.get('c')).toEqual({ kind: 'not-replacement' });
    expect(result.get('r')).toEqual({ kind: 'interval', km: 10000 });
  });

  it('mixed history: intervals connect consecutive replacements only', () => {
    const newestFirst = [
      k('c3', '2026-09-01T00:00:00Z', 121500, 'check'),
      k('r3', '2026-08-01T00:00:00Z', 120000, 'replacement'),
      k('t2', '2026-06-01T00:00:00Z', 116000, 'top_up'),
      k('c2', '2026-05-01T00:00:00Z', 114000, 'check'),
      k('r2', '2026-04-01T00:00:00Z', 110500, 'replacement'),
      k('t1', '2026-02-01T00:00:00Z', 104000, 'top_up'),
      k('r1', '2026-01-01T00:00:00Z', 100000, 'replacement'),
    ];
    const rows = buildItemHistory(newestFirst, null);
    expect(Object.fromEntries(rows.map(({ event, interval }) => [event.id, interval]))).toEqual({
      c3: { kind: 'not-replacement' }, r3: { kind: 'interval', km: 9500 }, t2: { kind: 'not-replacement' },
      c2: { kind: 'not-replacement' }, r2: { kind: 'interval', km: 10500 }, t1: { kind: 'not-replacement' },
      r1: { kind: 'first' },
    });
  });
});

describe('buildItemHistory (pages + previous replacement)', () => {
  const k = (id: string, day: number, km: number, kind: ServiceEventKind): HistoryEvent => ({
    ...ev(id, new Date(Date.UTC(2020, 0, day)).toISOString(), km), kind,
  });

  it('uses the previous replacement for the oldest loaded one, however many checks lie between', () => {
    // A full page: one replacement followed (older) by nine checks/top-ups.
    const page = [k('r2', 30, 110000, 'replacement'),
      ...Array.from({ length: 9 }, (_, i) => k(`x${i}`, 29 - i, 109000 - i * 100, i % 2 ? 'check' : 'top_up'))];
    const previous = k('r1', 1, 100000, 'replacement');
    const rows = buildItemHistory(page, previous);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.event.id)).not.toContain('r1');
    expect(rows[0].interval).toEqual({ kind: 'interval', km: 10000 });
    expect(rows.slice(1).every((r) => r.interval.kind === 'not-replacement')).toBe(true);
  });

  it('shows "first" when no older replacement exists', () => {
    const rows = buildItemHistory([k('c', 3, 100500, 'check'), k('r', 2, 100000, 'replacement')], null);
    expect(rows.map((r) => r.interval)).toEqual([{ kind: 'not-replacement' }, { kind: 'first' }]);
  });

  it('handles an empty history', () => {
    expect(buildItemHistory([], null)).toEqual([]);
  });

  it('merges pages newest first without duplicates, ordering equal date and mileage by id', () => {
    const t = '2026-04-01T09:00:00Z';
    const a = ev('a', t, 100000), b = ev('b', t, 100000), c = ev('c', '2026-03-01T00:00:00Z', 99000);
    expect(mergeHistoryPages([b, a], [a, c]).map((e) => e.id)).toEqual(['b', 'a', 'c']);
    expect(mergeHistoryPages([], [c, b, a]).map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });
});
