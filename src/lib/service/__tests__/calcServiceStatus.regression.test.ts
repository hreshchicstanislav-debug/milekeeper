import { describe, it, expect } from 'vitest';
import { calcServiceStatus } from '../calcServiceStatus';
import type { ServiceItem, ServiceEvent } from '@/lib/db/types';

// Helper to create a minimal ServiceItem
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

// Helper to create a minimal ServiceEvent
function createServiceEvent(overrides: Partial<ServiceEvent>): ServiceEvent {
  return {
    id: 'test-event',
    service_item_id: 'test-item',
    occurred_at: '2026-01-01T00:00:00Z',
    mileage_km: 150000,
    note: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('calcServiceStatus regression tests', () => {
  describe('km-mode: remainingDays must be finite when remainingKm is finite', () => {
    it('should return finite remainingDays when dailyKmRate is 0 (fallback to 30)', () => {
      // Given: km-mode item with dailyKmRate = 0 (invalid)
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 159000; // 1000 km remaining
      
      // When: calculate status with dailyKmRate = 0
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: 0, // Invalid: should trigger fallback
      });
      
      // Then: remainingKm should be finite
      expect(result.remainingKm).toBe(1000);
      expect(Number.isFinite(result.remainingKm)).toBe(true);
      
      // And: remainingDays should be finite (using fallback 30 km/day)
      expect(result.remainingDays).not.toBeNull();
      expect(Number.isFinite(result.remainingDays)).toBe(true);
      expect(result.remainingDays).toBeCloseTo(33.33, 1); // 1000/30
      
      // And: dailyKmRateUsed should be 30 (fallback)
      expect(result.dailyKmRateUsed).toBe(30);
    });

    it('should return finite remainingDays when dailyKmRate is null (fallback to 30)', () => {
      // Given: km-mode item with dailyKmRate = null
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 159000; // 1000 km remaining
      
      // When: calculate status with dailyKmRate = null
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: null, // Should trigger fallback
      });
      
      // Then: remainingKm should be finite
      expect(result.remainingKm).toBe(1000);
      expect(Number.isFinite(result.remainingKm)).toBe(true);
      
      // And: remainingDays should be finite (using fallback 30 km/day)
      expect(result.remainingDays).not.toBeNull();
      expect(Number.isFinite(result.remainingDays)).toBe(true);
      expect(result.remainingDays).toBeCloseTo(33.33, 1); // 1000/30
    });

    it('should return finite remainingDays when dailyKmRate is NaN (fallback to 30)', () => {
      // Given: km-mode item with dailyKmRate = NaN (invalid)
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 159000; // 1000 km remaining
      
      // When: calculate status with dailyKmRate = NaN
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: NaN as any, // Invalid: should trigger fallback
      });
      
      // Then: remainingKm should be finite
      expect(result.remainingKm).toBe(1000);
      expect(Number.isFinite(result.remainingKm)).toBe(true);
      
      // And: remainingDays should be finite (using fallback 30 km/day)
      expect(result.remainingDays).not.toBeNull();
      expect(Number.isFinite(result.remainingDays)).toBe(true);
      expect(result.remainingDays).toBeCloseTo(33.33, 1); // 1000/30
    });

    it('should return finite remainingDays when dailyKmRate is Infinity (fallback to 30)', () => {
      // Given: km-mode item with dailyKmRate = Infinity (invalid)
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 159000; // 1000 km remaining
      
      // When: calculate status with dailyKmRate = Infinity
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: Infinity as any, // Invalid: should trigger fallback
      });
      
      // Then: remainingKm should be finite
      expect(result.remainingKm).toBe(1000);
      expect(Number.isFinite(result.remainingKm)).toBe(true);
      
      // And: remainingDays should be finite (using fallback 30 km/day)
      expect(result.remainingDays).not.toBeNull();
      expect(Number.isFinite(result.remainingDays)).toBe(true);
      expect(result.remainingDays).toBeCloseTo(33.33, 1); // 1000/30
    });

    it('should return finite remainingDays when dailyKmRate is negative (fallback to 30)', () => {
      // Given: km-mode item with dailyKmRate = -10 (invalid)
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 159000; // 1000 km remaining
      
      // When: calculate status with dailyKmRate = -10
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: -10, // Invalid: should trigger fallback
      });
      
      // Then: remainingKm should be finite
      expect(result.remainingKm).toBe(1000);
      expect(Number.isFinite(result.remainingKm)).toBe(true);
      
      // And: remainingDays should be finite (using fallback 30 km/day)
      expect(result.remainingDays).not.toBeNull();
      expect(Number.isFinite(result.remainingDays)).toBe(true);
      expect(result.remainingDays).toBeCloseTo(33.33, 1); // 1000/30
    });

    it('should return finite remainingDays when dailyKmRate is an object (type error, fallback to 30)', () => {
      // Given: km-mode item with dailyKmRate as object (type error)
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 159000; // 1000 km remaining
      
      // When: calculate status with dailyKmRate as object
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate: { value: 50 } as any, // Invalid: should trigger fallback
      });
      
      // Then: remainingKm should be finite
      expect(result.remainingKm).toBe(1000);
      expect(Number.isFinite(result.remainingKm)).toBe(true);
      
      // And: remainingDays should be finite (using fallback 30 km/day)
      expect(result.remainingDays).not.toBeNull();
      expect(Number.isFinite(result.remainingDays)).toBe(true);
      expect(result.remainingDays).toBeCloseTo(33.33, 1); // 1000/30
    });

    it('should return finite remainingDays when remainingKm is negative (overdue)', () => {
      // Given: km-mode item that is overdue
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 161000; // -1000 km (overdue)
      const dailyKmRate = 100;
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate,
      });
      
      // Then: remainingKm should be finite and negative
      expect(result.remainingKm).toBe(-1000);
      expect(Number.isFinite(result.remainingKm)).toBe(true);
      
      // And: remainingDays should be finite and negative
      expect(result.remainingDays).not.toBeNull();
      expect(Number.isFinite(result.remainingDays)).toBe(true);
      expect(result.remainingDays).toBe(-10); // -1000/100
    });

    it('should return finite remainingDays when remainingKm is zero (exactly at due)', () => {
      // Given: km-mode item exactly at due mileage
      const item = createServiceItem({
        measurement_mode: 'km',
        interval_km: 10000,
      });
      const lastEvent = createServiceEvent({
        mileage_km: 150000,
      });
      const currentMileage = 160000; // 0 km remaining (exactly at due)
      const dailyKmRate = 100;
      
      // When: calculate status
      const result = calcServiceStatus({
        serviceItem: item,
        latestOdometerMileageKm: currentMileage,
        lastEvent,
        dailyKmRate,
      });
      
      // Then: remainingKm should be finite and zero
      expect(result.remainingKm).toBe(0);
      expect(Number.isFinite(result.remainingKm)).toBe(true);
      
      // And: remainingDays should be finite and zero
      expect(result.remainingDays).not.toBeNull();
      expect(Number.isFinite(result.remainingDays)).toBe(true);
      expect(result.remainingDays).toBe(0); // 0/100 = 0
    });
  });
});

