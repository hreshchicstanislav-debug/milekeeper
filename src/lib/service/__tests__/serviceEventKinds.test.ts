import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceEvent, ServiceEventKind, ServiceItem } from '@/lib/db/types';
import { calcServiceStatus } from '../calcServiceStatus';
import {
  AMOUNT_LITERS_MAX, checkServiceEventDate, findLastReplacement, isReplacementEvent, isValidAmountLiters, parseAmountLitersInput,
  SERVICE_EVENT_MIN_DATE,
} from '../serviceEventKinds';
import { getGettingStartedStep } from '@/lib/home/gettingStarted';
import { occurredAtFromDateInput, toDateInputValue } from '@/lib/time/datetimeLocal';

const db = vi.hoisted(() => ({ rows: [] as ServiceEvent[], calls: [] as unknown[][] }));
vi.mock('@/lib/supabase/rlsServerClient', () => ({
  getRlsClientAndUserId: async () => ({
    userId: 'user-a',
    supabase: {
      from: () => {
        const filters: Array<(row: Record<string, unknown>) => boolean> = [];
        const field = (row: unknown, column: string) => (row as Record<string, unknown>)[column];
        const query: Record<string, unknown> = {
          select: () => query,
          eq: (column: string, value: unknown) => { db.calls.push(['eq', column, value]); filters.push((row) => field(row, column) === value); return query; },
          in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(field(row, column))); return query; },
          // Rows are kept newest first, as the database orders them.
          order: () => query,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: db.rows.filter((row) => filters.every((f) => f(row as unknown as Record<string, unknown>))), error: null }).then(resolve),
        };
        return query;
      },
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/odometerActions', () => ({ getMaxMileageEntry: vi.fn() }));

import { listLastServiceEventsForItems } from '@/lib/actions/serviceActions';

const now = new Date('2026-10-01T12:00:00Z');
const kmItem: ServiceItem = {
  id: 'oil', user_id: 'user-a', title: 'Oil', interval_km: 10000, interval_days: null, notify_before_days: 30,
  notify_before_km: null, measurement_mode: 'km', note: null, is_active: true, created_at: '2025-01-01T00:00:00Z',
};
const calendarItem: ServiceItem = { ...kmItem, id: 'brake', measurement_mode: 'calendar', interval_km: null, interval_days: 365 };
const record = (id: string, date: string, km: number, kind: ServiceEventKind, item = 'oil'): ServiceEvent => ({
  id, user_id: 'user-a', service_item_id: item, occurred_at: date, mileage_km: km, note: null, created_at: date,
  kind, amount_liters: kind === 'top_up' ? 0.5 : null,
});
const status = (item: ServiceItem, lastEvent: ServiceEvent | null) =>
  calcServiceStatus({ serviceItem: item, latestOdometerMileageKm: 118000, lastEvent, dailyKmRate: 40, now });

// Newest first, as stored and returned by the history API.
const replacementOnly = [record('r1', '2026-03-01T09:00:00Z', 110000, 'replacement')];
const afterTopUpAndCheck = [
  record('c1', '2026-09-20T09:00:00Z', 117500, 'check'),
  record('t1', '2026-07-01T09:00:00Z', 114000, 'top_up'),
  ...replacementOnly,
];

beforeEach(() => { db.rows = []; db.calls = []; });

describe('replacement → top-up → check keeps the forecast of the replacement', () => {
  it.each([kmItem, calendarItem])('$measurement_mode item: same last replacement, due date, remaining and status', (item) => {
    const before = status(item, findLastReplacement(replacementOnly));
    const after = status(item, findLastReplacement(afterTopUpAndCheck));
    expect(findLastReplacement(afterTopUpAndCheck)?.id).toBe('r1');
    expect(after).toEqual(before);
  });

  it('the server map ignores checks and top-ups (query filter and defensive check)', async () => {
    db.rows = [...afterTopUpAndCheck, record('cal-check', '2026-09-01T00:00:00Z', 116000, 'check', 'brake')];
    const map = await listLastServiceEventsForItems(['oil', 'brake']);
    expect(db.calls).toContainEqual(['eq', 'kind', 'replacement']);
    expect(map.oil?.id).toBe('r1');
    // Only a check exists for "brake": it is still an item without a replacement.
    expect(map.brake).toBeNull();
  });

  it('an item with only checks still asks for the first replacement', async () => {
    db.rows = [record('c', '2026-09-01T00:00:00Z', 116000, 'check')];
    const lastEventsMap = await listLastServiceEventsForItems(['oil']);
    const reading = { id: 'r', user_id: 'user-a', occurred_at: now.toISOString(), mileage_km: 118000, note: null, created_at: now.toISOString() };
    expect(getGettingStartedStep({
      loaded: true, maxMileageEntry: reading, odometerEntries: [reading], serviceItems: [kmItem], lastEventsMap, dailyRate: 40,
    })).toEqual({ kind: 'replacement', item: kmItem });
  });
});

describe('deleting records recomputes from the remaining history', () => {
  const history = [
    record('c2', '2026-09-20T09:00:00Z', 117500, 'check'),
    record('r2', '2026-08-01T09:00:00Z', 115000, 'replacement'),
    record('t1', '2026-05-01T09:00:00Z', 112000, 'top_up'),
    record('r1', '2026-03-01T09:00:00Z', 110000, 'replacement'),
  ];
  const without = (id: string) => history.filter((event) => event.id !== id);

  it('deleting a check (or a top-up) does not change the forecast', () => {
    const before = status(kmItem, findLastReplacement(history));
    expect(status(kmItem, findLastReplacement(without('c2')))).toEqual(before);
    expect(status(kmItem, findLastReplacement(without('t1')))).toEqual(before);
  });

  it('deleting the last replacement falls back to the previous one', () => {
    const before = status(kmItem, findLastReplacement(history));
    const after = status(kmItem, findLastReplacement(without('r2')));
    expect(findLastReplacement(without('r2'))?.id).toBe('r1');
    expect(before.remainingKm).toBe(115000 + 10000 - 118000);
    expect(after.remainingKm).toBe(110000 + 10000 - 118000);
  });

  it('deleting the only replacement leaves the item without a baseline', () => {
    expect(findLastReplacement([record('c', '2026-09-01T00:00:00Z', 1, 'check')])).toBeNull();
    expect(status(kmItem, null).status).toBe('UNKNOWN');
  });
});

describe('kind helpers', () => {
  it('treats a record without kind (older rows) as a replacement', () => {
    expect(isReplacementEvent({})).toBe(true);
    expect(isReplacementEvent({ kind: 'check' })).toBe(false);
    expect(isReplacementEvent({ kind: 'top_up' })).toBe(false);
  });

  it.each([
    ['', null], ['  ', null], ['0,5', 0.5], ['0.5', 0.5], [' 1 ', 1], ['2,25', 2.25], ['99,99', 99.99], [',5', 0.5], ['1 ,5', 1.5],
    // No product limit: anything numeric(5,2) can hold is accepted.
    ['100', 100], ['250,5', 250.5], ['999.99', 999.99], ['999,9', 999.9],
  ])('parses volume %j', (raw, value) => expect(parseAmountLitersInput(raw)).toEqual({ ok: true, value }));

  it.each(['0', '0,00', '1,234', '0,001', '1000', '1000,5', '99999', 'abc', '-1', '1,2,3', '1e2', '1.', 'NaN', 'Infinity', '0x10'])(
    'rejects volume %j', (raw) => expect(parseAmountLitersInput(raw)).toEqual({ ok: false }));

  it('keeps the limit equal to the numeric(5,2) range', () => {
    expect(AMOUNT_LITERS_MAX).toBe(999.99);
    expect(isValidAmountLiters(999.99)).toBe(true);
    expect(isValidAmountLiters(1000)).toBe(false);
    expect(isValidAmountLiters(0.01)).toBe(true);
    expect(isValidAmountLiters(0.001)).toBe(false);
  });
});

describe('date-only field', () => {
  const today = new Date(2026, 9, 9, 15, 42);

  it('defaults to today in the local zone and stores now for today', () => {
    expect(toDateInputValue(today)).toBe('2026-10-09');
    expect(occurredAtFromDateInput('2026-10-09', today)?.getTime()).toBe(today.getTime());
  });

  it('stores local noon for another day and rejects impossible dates', () => {
    expect(occurredAtFromDateInput('2026-03-01', today)).toEqual(new Date(2026, 2, 1, 12));
    for (const value of ['', '2026-02-30', '2026-13-01', '01.03.2026']) expect(occurredAtFromDateInput(value, today)).toBeNull();
  });
});

describe('record date check (server rule)', () => {
  const now = new Date('2026-11-04T10:00:00Z');

  it('accepts now, today, the past and a few minutes of client clock skew', () => {
    for (const iso of ['2026-11-04T10:00:00Z', '2026-11-04T10:05:00Z', '2026-11-03T12:00:00Z', '2026-01-01T12:00:00Z', '1950-01-01T12:00:00Z']) {
      expect(checkServiceEventDate(new Date(iso), now), iso).toBe('ok');
    }
  });

  it('rejects anything later than now, including tomorrow noon in any time zone', () => {
    for (const iso of ['2026-11-04T10:11:00Z', '2026-11-05T12:00:00Z', '2027-01-01T00:00:00Z', '9999-12-31T00:00:00Z']) {
      expect(checkServiceEventDate(new Date(iso), now), iso).toBe('in-future');
    }
  });

  it('rejects mistyped years that are far too old', () => {
    expect(SERVICE_EVENT_MIN_DATE).toBe('1950-01-01');
    for (const iso of ['1949-06-01T12:00:00Z', '1015-03-01T12:00:00Z', '0001-01-01T00:00:00Z']) {
      expect(checkServiceEventDate(new Date(iso), now), iso).toBe('too-old');
    }
  });
});
