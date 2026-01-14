import { describe, it, expect } from 'vitest';
import { calcServiceStatus } from '../calcServiceStatus';
import type { ServiceItem, ServiceEvent } from '@/lib/db/types';

function createServiceItem(overrides: Partial<ServiceItem>): ServiceItem {
  return {
    id: 'test-item',
    title: 'Test Item',
    interval_km: null,
    interval_days: null,
    notify_before_days: 30,
    notify_before_km: null,
    measurement_mode: 'km',
    note: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createServiceEvent(overrides: Partial<ServiceEvent>): ServiceEvent {
  return {
    id: 'test-event',
    service_item_id: 'test-item',
    occurred_at: '2026-01-01T12:00:00Z',
    mileage_km: 150000,
    note: null,
    created_at: '2026-01-01T12:00:00Z',
    ...overrides,
  };
}

describe('calcServiceStatus regression (TO-BE MVP)', () => {
  it('km-mode: when dailyKmRate is invalid/insufficient, remainingDays is null (no implicit fallback)', () => {
    const item = createServiceItem({ measurement_mode: 'km', interval_km: 10000 });
    const lastEvent = createServiceEvent({ mileage_km: 150000 });
    const now = new Date('2026-01-15T12:00:00Z');

    const r1 = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: 159000, // kmLeft = 1000
      lastEvent,
      dailyKmRate: null,
      now,
    });
    expect(r1.remainingKm).toBe(1000);
    expect(r1.remainingDays).toBeNull();
    expect(r1.dailyKmRateUsed).toBeNull();

    const r2 = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: 159000,
      lastEvent,
      dailyKmRate: 0,
      now,
    });
    expect(r2.remainingDays).toBeNull();
    expect(r2.dailyKmRateUsed).toBe(0);

    const r3 = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: 159000,
      lastEvent,
      dailyKmRate: NaN as any,
      now,
    });
    expect(r3.remainingDays).toBeNull();
    expect(Number.isNaN(r3.dailyKmRateUsed as any)).toBe(true);
  });
});

