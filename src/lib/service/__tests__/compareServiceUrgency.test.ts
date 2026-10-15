import { describe, it, expect } from 'vitest';
import { compareServiceUrgency } from '../calcServiceStatus';
import type { ServiceStatusResult } from '../calcServiceStatus';
import type { ServiceItem } from '@/lib/db/types';

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

// Helper to create a minimal ServiceStatusResult
function createStatusResult(overrides: Partial<ServiceStatusResult>): ServiceStatusResult {
  return {
    status: 'OK',
    limitingFactor: 'km',
    primary: {
      kind: 'km',
      remainingValue: 1000,
      dueValue: 160000,
      unit: 'км',
      label: 'По пробегу',
    },
    why: 'OK',
    remainingKm: 1000,
    remainingDays: null,
    ...overrides,
  };
}

describe('compareServiceUrgency', () => {
  it('should prioritize OVERDUE over SOON', () => {
    // Given: OVERDUE vs SOON
    const overdue = {
      item: createServiceItem({ title: 'Overdue Item' }),
      statusResult: createStatusResult({
        status: 'OVERDUE',
        remainingKm: -100,
        remainingDays: -5,
      }),
    };
    const soon = {
      item: createServiceItem({ title: 'Soon Item' }),
      statusResult: createStatusResult({
        status: 'SOON',
        remainingKm: 500,
        remainingDays: 10,
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(overdue, soon);
    
    // Then: OVERDUE should come first (negative number)
    expect(result).toBeLessThan(0);
  });

  it('should prioritize SOON over OK', () => {
    // Given: SOON vs OK
    const soon = {
      item: createServiceItem({ title: 'Soon Item' }),
      statusResult: createStatusResult({
        status: 'SOON',
        remainingKm: 500,
        remainingDays: 10,
      }),
    };
    const ok = {
      item: createServiceItem({ title: 'OK Item' }),
      statusResult: createStatusResult({
        status: 'OK',
        remainingKm: 5000,
        remainingDays: 100,
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(soon, ok);
    
    // Then: SOON should come first (negative number)
    expect(result).toBeLessThan(0);
  });

  it('should prioritize OK over UNKNOWN', () => {
    // Given: OK vs UNKNOWN
    const ok = {
      item: createServiceItem({ title: 'OK Item' }),
      statusResult: createStatusResult({
        status: 'OK',
        remainingKm: 5000,
        remainingDays: 100,
      }),
    };
    const unknown = {
      item: createServiceItem({ title: 'Unknown Item' }),
      statusResult: createStatusResult({
        status: 'UNKNOWN',
        limitingFactor: 'none',
        remainingKm: null,
        remainingDays: null,
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(ok, unknown);
    
    // Then: OK should come first (negative number)
    expect(result).toBeLessThan(0);
  });

  it('should prioritize days over km when both have same remainingKm (SOON status)', () => {
    // Given: Two SOON items with same remainingKm but different remainingDays
    const itemA = {
      item: createServiceItem({ title: 'Item A' }),
      statusResult: createStatusResult({
        status: 'SOON',
        remainingKm: 147,
        remainingDays: 2, // Smaller = more urgent
      }),
    };
    const itemB = {
      item: createServiceItem({ title: 'Item B' }),
      statusResult: createStatusResult({
        status: 'SOON',
        remainingKm: 147, // Same km
        remainingDays: 5, // Larger = less urgent
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(itemA, itemB);
    
    // Then: Item A (smaller remainingDays) should come first (negative number)
    expect(result).toBeLessThan(0);
  });

  it('should prioritize days over km when both have same remainingKm (OK status)', () => {
    // Given: Two OK items with same remainingKm but different remainingDays
    const itemA = {
      item: createServiceItem({ title: 'Item A' }),
      statusResult: createStatusResult({
        status: 'OK',
        remainingKm: 5000,
        remainingDays: 50, // Smaller = more urgent
      }),
    };
    const itemB = {
      item: createServiceItem({ title: 'Item B' }),
      statusResult: createStatusResult({
        status: 'OK',
        remainingKm: 5000, // Same km
        remainingDays: 100, // Larger = less urgent
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(itemA, itemB);
    
    // Then: Item A (smaller remainingDays) should come first (negative number)
    expect(result).toBeLessThan(0);
  });

  it('should compare by remainingKm when remainingDays are equal (SOON status)', () => {
    // Given: Two SOON items with same remainingDays but different remainingKm
    const itemA = {
      item: createServiceItem({ title: 'Item A' }),
      statusResult: createStatusResult({
        status: 'SOON',
        remainingKm: 100, // Smaller = more urgent
        remainingDays: 10,
      }),
    };
    const itemB = {
      item: createServiceItem({ title: 'Item B' }),
      statusResult: createStatusResult({
        status: 'SOON',
        remainingKm: 500, // Larger = less urgent
        remainingDays: 10, // Same days
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(itemA, itemB);
    
    // Then: Item A (smaller remainingKm) should come first (negative number)
    expect(result).toBeLessThan(0);
  });

  it('should prioritize item with remainingDays over item without (SOON status)', () => {
    // Given: Two SOON items, one with remainingDays, one without
    const itemWithDays = {
      item: createServiceItem({ title: 'Item With Days' }),
      statusResult: createStatusResult({
        status: 'SOON',
        remainingKm: 500,
        remainingDays: 10, // Has days
      }),
    };
    const itemWithoutDays = {
      item: createServiceItem({ title: 'Item Without Days' }),
      statusResult: createStatusResult({
        status: 'SOON',
        remainingKm: 500,
        remainingDays: null, // No days
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(itemWithDays, itemWithoutDays);
    
    // Then: Item with days should come first (has more info)
    expect(result).toBeLessThan(0);
  });

  it('should compare OVERDUE items by severity (most negative first)', () => {
    // Given: Two OVERDUE items with different severity
    const moreOverdue = {
      item: createServiceItem({ title: 'More Overdue' }),
      statusResult: createStatusResult({
        status: 'OVERDUE',
        remainingKm: -500,
        remainingDays: -10, // More negative = more overdue
      }),
    };
    const lessOverdue = {
      item: createServiceItem({ title: 'Less Overdue' }),
      statusResult: createStatusResult({
        status: 'OVERDUE',
        remainingKm: -100,
        remainingDays: -2, // Less negative = less overdue
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(moreOverdue, lessOverdue);
    
    // Then: More overdue should come first (severity -10 < -2)
    expect(result).toBeLessThan(0);
  });

  it('should use title as tie-breaker when all metrics are equal', () => {
    // Given: Two items with identical metrics
    const itemA = {
      item: createServiceItem({ title: 'A Item' }),
      statusResult: createStatusResult({
        status: 'OK',
        remainingKm: 1000,
        remainingDays: 20,
      }),
    };
    const itemB = {
      item: createServiceItem({ title: 'B Item' }),
      statusResult: createStatusResult({
        status: 'OK',
        remainingKm: 1000,
        remainingDays: 20,
      }),
    };
    
    // When: compare
    const result = compareServiceUrgency(itemA, itemB);
    
    // Then: Should sort by title (A before B in Russian locale)
    expect(result).toBeLessThan(0);
  });
});

