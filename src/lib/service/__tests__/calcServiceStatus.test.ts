import { describe, it, expect } from 'vitest';
import { calcServiceStatus } from '../calcServiceStatus';
import type { ServiceItem, ServiceEvent } from '@/lib/db/types';

// Helper to create a minimal ServiceItem
function createServiceItem(overrides: Partial<ServiceItem>): ServiceItem {
  return {
    id: 'test-item',
    user_id: 'user-1',
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

// Helper to create a minimal ServiceEvent
function createServiceEvent(overrides: Partial<ServiceEvent>): ServiceEvent {
  return {
    id: 'test-event',
    user_id: 'user-1',
    service_item_id: 'test-item',
    occurred_at: '2026-01-01T00:00:00Z',
    mileage_km: 150000,
    note: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('calcServiceStatus', () => {
  describe('km-mode', () => {
    it('should calculate remainingDays from remainingKm/dailyKmRate', () => {
      // Given: km-mode item with interval_km=10000, lastEvent at 150000, current at 159000, dailyKmRate=100
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
        interval_days: null,
        notify_before_days: 4,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
        occurred_at: '2026-01-01T00:00:00Z',
      });
      const currentMileage = 159000;
      const dailyKmRate = 100;
      const now = new Date('2026-01-15T00:00:00Z');
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate,
        now,
      });
      
      // Then: remainingKm should be 1000 (150000 + 10000 - 159000)
      expect(result.remainingKm).toBe(1000);
      
      // And: remainingDays should be ~10 (1000/100)
      expect(result.remainingDays).toBeCloseTo(10, 1);
      
      // IMPORTANT: Status should be OK (not SOON) because:
      // - remainingDays (10) > notify_before_days (4)
      // - SOON is triggered ONLY by remainingDays <= notify_before_days
      // - This test explicitly documents that SOON is NOT triggered by km threshold
      expect(result.status).toBe('OK');
      
      // Verify limiting factor is 'km' for km-mode
      expect(result.limitingFactor).toBe('km');
    });

    it('should set status to SOON when remainingDays <= notify_before_days (km-mode)', () => {
      // Given: km-mode item with small remainingKm that results in remainingDays <= notify_before_days
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
        notify_before_days: 14,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 159500; // 500 km remaining
      const dailyKmRate = 50; // 500/50 = 10 days
      const now = new Date('2026-01-15T00:00:00Z');
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate,
        now,
      });
      
      // Then: remainingDays should be ~10 (500/50)
      expect(result.remainingDays).toBeCloseTo(10, 1);
      
      // And: status should be SOON (10 <= 14)
      expect(result.status).toBe('SOON');
    });

    it('should NOT use fallback dailyKmRate when dailyKmRate is null (TO-BE: insufficient data)', () => {
      // Given: km-mode item without dailyKmRate
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 159000; // 1000 km remaining
      const now = new Date('2026-01-15T00:00:00Z');
      
      // When: calculate status without dailyKmRate
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: null,
        now,
      });
      
      // Then (TO-BE): no fallback; remainingDays is null and dailyKmRateUsed is null
      expect(result.dailyKmRateUsed).toBeNull();
      expect(result.remainingDays).toBeNull();
    });

    it('should set status to OVERDUE when remainingKm <= 0 (km-mode)', () => {
      // Given: km-mode item that is overdue by km
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 161000; // 1000 km overdue
      const now = new Date('2026-01-15T00:00:00Z');
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: 100,
        now,
      });
      
      // Then: remainingKm should be negative
      expect(result.remainingKm).toBeLessThan(0);
      
      // And: status should be OVERDUE
      expect(result.status).toBe('OVERDUE');
    });

    it('should return UNKNOWN when no lastEvent', () => {
      // Given: item without lastEvent
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: 150000,
        lastEvent: null,
        dailyKmRate: 100,
        now: new Date('2026-01-15T00:00:00Z'),
      });
      
      // Then: status should be UNKNOWN
      expect(result.status).toBe('UNKNOWN');
      expect(result.limitingFactor).toBe('none');
    });
  });

  describe('calendar-mode', () => {
    it('should calculate due date based on lastEvent.occurred_at + interval_days', () => {
      // Given: calendar-mode item with interval_days=365, lastEvent on 2025-01-01, now is 2025-12-10
      const item = createServiceItem({
        measurement_mode: 'calendar',
        interval_days: 365,
        notify_before_days: 30,
      });
      const lastEvent = createServiceEvent({
        occurred_at: '2025-01-01T00:00:00Z',
        mileage_km: 150000,
      });
      const now = new Date('2025-12-10T00:00:00Z');
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: 160000,
        lastEvent,
        now,
      });
      
      // Then: due date should be 2026-01-01 (365 days after 2025-01-01)
      // remainingDays should be about 22 (from 2025-12-10 to 2026-01-01)
      expect(result.remainingDays).toBeCloseTo(22, 1);
      
      // And: status should be SOON (22 <= 30)
      expect(result.status).toBe('SOON');
      
      // Verify limiting factor is 'time' for calendar-mode
      expect(result.limitingFactor).toBe('time');
    });

    it('should set status to OVERDUE when remainingDays < 0 (calendar-mode)', () => {
      // Given: calendar-mode item that is overdue by days
      const item = createServiceItem({
        measurement_mode: 'calendar',
        interval_days: 365,
      });
      const lastEvent = createServiceEvent({
        occurred_at: '2024-01-01T00:00:00Z',
        mileage_km: 150000,
      });
      const now = new Date('2025-01-15T00:00:00Z'); // 14 days overdue
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: 160000,
        lastEvent,
        now,
      });
      
      // Then: remainingDays should be negative
      expect(result.remainingDays).toBeLessThan(0);
      
      // And: status should be OVERDUE
      expect(result.status).toBe('OVERDUE');
    });

    it('should return UNKNOWN when interval_days is null for calendar-mode', () => {
      // Given: calendar-mode item without interval_days
      const item = createServiceItem({
        measurement_mode: 'calendar',
        interval_days: null, // Missing!
      });
      const lastEvent = createServiceEvent({
        occurred_at: '2025-01-01T00:00:00Z',
      });
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: 160000,
        lastEvent,
        now: new Date('2025-12-10T00:00:00Z'),
      });
      
      // Then: status should be UNKNOWN
      expect(result.status).toBe('UNKNOWN');
      expect(result.limitingFactor).toBe('none');
    });

    it('should handle calendar-mode with both interval_km and interval_days (limiting factor)', () => {
      // Given: calendar-mode item with both intervals
      // interval_days=365 (due 2026-01-01), interval_km=10000 (due at 160000)
      // currentMileage=159000 (1000 km remaining), now=2025-12-10 (22 days remaining)
      const item = createServiceItem({
        measurement_mode: 'calendar',
        interval_days: 365,
        interval_km: 10000,
        notify_before_days: 30,
      });
      const lastEvent = createServiceEvent({
        occurred_at: '2025-01-01T00:00:00Z',
        mileage_km: 150000,
      });
      const now = new Date('2025-12-10T00:00:00Z');
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: 159000,
        lastEvent,
        now,
      });
      
      // Then: both remainingKm and remainingDays should be available
      expect(result.remainingKm).toBe(1000);
      expect(result.remainingDays).toBeCloseTo(22, 1);
      
      // And: limiting factor should be 'time' (22 < 1000, so days reach 0 sooner)
      // The logic chooses the smaller remaining value as limiting factor
      expect(result.limitingFactor).toBe('time');
      
      // And: status should be SOON (remainingDays=22 <= notify_before_days=30)
      expect(result.status).toBe('SOON');
    });

    it('should choose km as limiting factor when remainingKm < remainingDays (calendar-mode)', () => {
      // Given: calendar-mode item where km is more urgent than days
      // interval_days=365 (due 2026-01-01), interval_km=10000 (due at 160000)
      // currentMileage=159900 (100 km remaining), now=2025-12-20 (12 days remaining)
      const item = createServiceItem({
        measurement_mode: 'calendar',
        interval_days: 365,
        interval_km: 10000,
        notify_before_days: 30,
      });
      const lastEvent = createServiceEvent({
        occurred_at: '2025-01-01T00:00:00Z',
        mileage_km: 150000,
      });
      const now = new Date('2025-12-20T00:00:00Z');
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: 159900,
        lastEvent,
        now,
      });
      
      // Then: both remainingKm and remainingDays should be available
      expect(result.remainingKm).toBe(100);
      expect(result.remainingDays).toBeCloseTo(12, 1);
      
      // And: limiting factor should be 'km' (100 < 12? No, 100 > 12, so... wait, let me check the logic)
      // Actually, the logic compares remainingKm <= remainingDays, so if 100 > 12, then limitingFactor = 'time'
      // But if we want km to be limiting, we need remainingKm < remainingDays
      // Let me adjust: if remainingKm=50 and remainingDays=100, then km is limiting
      // Actually, I need to check the exact logic in calcServiceStatus
      // From the code: if remainingKm <= remainingDays, then limitingFactor = 'km'
      // So if remainingKm=50 and remainingDays=100, then 50 <= 100 -> 'km'
      // If remainingKm=100 and remainingDays=12, then 100 <= 12 is false -> 'time'
      // So for this test, I'll set remainingKm to be smaller than remainingDays
      // Let me recalculate: if currentMileage=159950, then remainingKm=50, and remainingDays=12
      // Then 50 > 12, so limitingFactor = 'time' (smaller remaining value)
      // Wait, I'm confusing myself. Let me re-read the code:
      // "if (remainingKm <= remainingDays) { limitingFactor = 'km' }"
      // So if remainingKm=50 and remainingDays=12, then 50 <= 12 is false, so limitingFactor = 'time'
      // The logic is: choose the one with smaller remaining (will hit 0 sooner)
      // So if remainingKm=50 and remainingDays=12, then days are more urgent (12 < 50), so limitingFactor = 'time'
      // If remainingKm=5 and remainingDays=12, then km is more urgent (5 < 12), so limitingFactor = 'km'
      
      // For this test, let's make remainingKm smaller than remainingDays
      // If currentMileage=159950, remainingKm=50, remainingDays=12 (from 2025-12-20 to 2026-01-01)
      // Actually, let me just test with a case where km is clearly smaller
      const result2 = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: 159950, // 50 km remaining
        lastEvent,
        now: new Date('2025-12-20T00:00:00Z'), // 12 days remaining
      });
      
      // Then: remainingKm should be 50, remainingDays should be ~12
      expect(result2.remainingKm).toBe(50);
      expect(result2.remainingDays).toBeCloseTo(12, 1);
      
      // And: limiting factor should be 'time' (12 < 50, so days reach 0 sooner)
      // Actually wait, the code says: "if (remainingKm <= remainingDays) { limitingFactor = 'km' }"
      // So if remainingKm=50 and remainingDays=12, then 50 <= 12 is false, so limitingFactor = 'time'
      // This is correct: days are more urgent
      expect(result2.limitingFactor).toBe('time');
      
      // But we want to test the case where km is limiting. Let's use a different scenario:
      // If remainingKm=5 and remainingDays=12, then 5 <= 12 is true, so limitingFactor = 'km'
      const result3 = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: 159995, // 5 km remaining
        lastEvent,
        dailyKmRate: 1, // TO-BE: enable km due date (daysLeftKm = ceil(5/1) = 5)
        now: new Date('2025-12-20T00:00:00Z'), // 12 days remaining
      });
      
      // Then: remainingKm should be 5, and (TO-BE) remainingDays is primary days-left for limiting factor
      expect(result3.remainingKm).toBe(5);
      expect(result3.remainingDays).toBe(5);
      
      // And: limiting factor should be 'km' (dueByKmDate earlier than dueByTimeDate)
      expect(result3.limitingFactor).toBe('km');
    });
  });

  describe('edge cases', () => {
    it('should handle negative remainingDays for km-mode (overdue by forecast)', () => {
      // Given: km-mode item overdue by km, which results in negative remainingDays
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 161000; // 1000 km overdue
      const dailyKmRate = 100; // -1000/100 = -10 days
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate,
        now: new Date('2026-01-15T00:00:00Z'),
      });
      
      // Then: both remainingKm and remainingDays should be negative
      expect(result.remainingKm).toBeLessThan(0);
      expect(result.remainingDays).toBeLessThan(0);
      
      // And: status should be OVERDUE
      expect(result.status).toBe('OVERDUE');
    });

    it('should handle zero remainingKm (exactly at due mileage)', () => {
      // Given: km-mode item exactly at due mileage
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 160000; // Exactly at due
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: 100,
        now: new Date('2026-01-15T00:00:00Z'),
      });
      
      // Then: remainingKm should be 0
      expect(result.remainingKm).toBe(0);
      
      // And: status should be OVERDUE (0 <= 0)
      expect(result.status).toBe('OVERDUE');
    });
  });
});

