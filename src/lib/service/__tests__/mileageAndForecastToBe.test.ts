import { describe, it, expect } from 'vitest';
import type { OdometerEntry, ServiceEvent, ServiceItem } from '@/lib/db/types';
import { calculateDailyMileageRateToBe } from '@/lib/service/dailyMileageRateToBe';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';

function odometerEntry(occurredAt: Date, mileageKm: number): OdometerEntry {
  const iso = occurredAt.toISOString();
  return {
    id: `${iso}:${mileageKm}`,
    user_id: 'user-1',
    occurred_at: iso,
    mileage_km: mileageKm,
    note: null,
    created_at: iso,
  };
}

function serviceEvent(occurredAt: Date, mileageKm: number): ServiceEvent {
  const iso = occurredAt.toISOString();
  return {
    id: `${iso}:${mileageKm}`,
    user_id: 'user-1',
    service_item_id: 'item-1',
    occurred_at: iso,
    mileage_km: mileageKm,
    note: null,
    created_at: iso,
  };
}

describe('TO-BE MVP: mileage + forecast calculations (docs/calculations/mileage-and-forecast-to-be.md)', () => {
  it('Scenario 1: day-buckets — internal entries do not change avgKmPerDay when start/end are unchanged', () => {
    const now = new Date(2025, 0, 2, 12, 0, 0);
    const entriesBase: OdometerEntry[] = [
      odometerEntry(new Date(2025, 0, 1, 10, 0, 0), 10000),
      odometerEntry(new Date(2025, 0, 1, 15, 0, 0), 10050),
      odometerEntry(new Date(2025, 0, 1, 20, 0, 0), 10100),
      odometerEntry(new Date(2025, 0, 2, 10, 0, 0), 10200),
    ];

    const base = calculateDailyMileageRateToBe(entriesBase, now);
    expect(base.dailyRate).toBe(100);
    expect(base.daysSpan).toBe(2);
    expect(base.firstDay).toBe('2025-01-01');
    expect(base.lastDay).toBe('2025-01-02');

    const entriesWithExtra = [
      ...entriesBase,
      odometerEntry(new Date(2025, 0, 1, 12, 0, 0), 10020), // internal, does not change min/max for the day
    ];
    const extra = calculateDailyMileageRateToBe(entriesWithExtra, now);
    expect(extra.dailyRate).toBe(100);
    expect(extra.daysSpan).toBe(2);
  });

  it('Scenario 2: rare input — daysSpan is calendar-inclusive span (not number of entries)', () => {
    const now = new Date(2025, 0, 8, 12, 0, 0);
    const entries: OdometerEntry[] = [
      odometerEntry(new Date(2025, 0, 1, 12, 0, 0), 10000),
      odometerEntry(new Date(2025, 0, 8, 12, 0, 0), 10500),
    ];

    const r = calculateDailyMileageRateToBe(entries, now);
    expect(r.daysSpan).toBe(8);
    expect(r.dailyRate).toBe(62.5);
  });

  it('Scenario 3: rolling 60 days excludes old history', () => {
    const now = new Date(2025, 0, 8, 12, 0, 0);
    const entries: OdometerEntry[] = [
      odometerEntry(new Date(2024, 0, 1, 12, 0, 0), 50000), // excluded (>60d)
      odometerEntry(new Date(2024, 11, 1, 12, 0, 0), 55000), // included
      odometerEntry(new Date(2025, 0, 8, 12, 0, 0), 56000), // included
    ];

    const r = calculateDailyMileageRateToBe(entries, now);
    // From 2024-12-01 to 2025-01-08 inclusive = 39 days; totalKm = 1000; avg = 1000/39
    expect(r.daysSpan).toBe(39);
    expect(r.dailyRate).toBeCloseTo(1000 / 39, 6);
  });

  it('Scenario 4: time-mode daysLeftTime decreases by 1 when today advances (no mileage input)', () => {
    const item: ServiceItem = {
      id: 'item-1',
      user_id: 'user-1',
      title: 'Time item',
      interval_km: null,
      interval_days: 365,
      notify_before_days: 14,
      notify_before_km: null,
      measurement_mode: 'calendar',
      note: null,
      is_active: true,
      created_at: new Date(2024, 0, 1, 12, 0, 0).toISOString(),
    };
    const lastEvent = serviceEvent(new Date(2024, 0, 1, 12, 0, 0), 0);

    const day1Now = new Date(2025, 0, 1, 12, 0, 0);
    const day1 = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: null,
      lastEvent,
      dailyKmRate: null,
      now: day1Now,
    });
    expect(day1.remainingDays).toBe(0);

    const day2Now = new Date(2025, 0, 2, 12, 0, 0);
    const day2 = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: null,
      lastEvent,
      dailyKmRate: null,
      now: day2Now,
    });
    expect(day2.remainingDays).toBe(-1);
  });

  it('Scenario 5: km-mode with valid dailyRate uses ceil(kmLeft / dailyRate)', () => {
    const item: ServiceItem = {
      id: 'item-1',
      user_id: 'user-1',
      title: 'Km item',
      interval_km: 10000,
      interval_days: null,
      notify_before_days: 7,
      notify_before_km: null,
      measurement_mode: 'km',
      note: null,
      is_active: true,
      created_at: new Date(2024, 0, 1, 12, 0, 0).toISOString(),
    };
    const lastEvent = serviceEvent(new Date(2024, 0, 1, 12, 0, 0), 50000);
    const now = new Date(2025, 0, 1, 12, 0, 0);

    const r = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: 55000,
      lastEvent,
      dailyKmRate: 50,
      now,
    });

    expect(r.remainingKm).toBe(5000);
    expect(r.remainingDays).toBe(100);
  });

  it('Scenario 6: consistency — same inputs produce same dailyRate value (single function)', () => {
    const now = new Date(2025, 0, 8, 12, 0, 0);
    const entries: OdometerEntry[] = [
      odometerEntry(new Date(2025, 0, 1, 12, 0, 0), 10000),
      odometerEntry(new Date(2025, 0, 8, 12, 0, 0), 10500),
    ];

    const r1 = calculateDailyMileageRateToBe(entries, now).dailyRate;
    const r2 = calculateDailyMileageRateToBe(entries, now).dailyRate;
    const r3 = calculateDailyMileageRateToBe(entries, now).dailyRate;
    expect(r1).toBe(62.5);
    expect(r2).toBe(62.5);
    expect(r3).toBe(62.5);
  });
});

