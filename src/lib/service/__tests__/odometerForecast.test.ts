import { describe, it, expect } from 'vitest';
import { estimateDailyKmRate, estimateDaysToReachKm } from '../odometerForecast';
import type { OdometerEntry } from '@/lib/db/types';

describe('odometerForecast', () => {
  describe('estimateDailyKmRate', () => {
    it('should calculate stable dailyKmRate from last entries', () => {
      // Given: synthetic odometer entries over 10 days with 50 km/day growth
      const baseDate = new Date('2026-01-01T00:00:00Z');
      const entries: OdometerEntry[] = [];
      
      for (let i = 0; i < 11; i++) {
        const date = new Date(baseDate);
        date.setDate(date.getDate() + i);
        entries.push({
          id: `entry-${i}`,
          occurred_at: date.toISOString(),
          mileage_km: 150000 + (i * 50), // 50 km per day
          note: null,
          created_at: date.toISOString(),
        });
      }
      
      // Reverse to get newest first (as expected by the function)
      entries.reverse();
      
      // When: estimate daily rate
      const result = estimateDailyKmRate(entries);
      
      // Then: should be close to 50 km/day, not fallback
      expect(result.dailyKmRate).toBeCloseTo(50, 1);
      expect(result.isFallback).toBe(false);
    });

    it('should use fallback when insufficient data (0 entries)', () => {
      // Given: no entries
      const entries: OdometerEntry[] = [];
      
      // When: estimate daily rate
      const result = estimateDailyKmRate(entries);
      
      // Then: should use fallback (30 km/day by default)
      expect(result.dailyKmRate).toBe(30);
      expect(result.isFallback).toBe(true);
    });

    it('should use fallback when insufficient data (1 entry)', () => {
      // Given: only one entry
      const entries: OdometerEntry[] = [{
        id: 'entry-1',
        occurred_at: '2026-01-01T00:00:00Z',
        mileage_km: 150000,
        note: null,
        created_at: '2026-01-01T00:00:00Z',
      }];
      
      // When: estimate daily rate
      const result = estimateDailyKmRate(entries);
      
      // Then: should use fallback
      expect(result.dailyKmRate).toBe(30);
      expect(result.isFallback).toBe(true);
    });

    it('should use fallback when entries are too old (>14 days)', () => {
      // Given: entries older than 14 days
      const baseDate = new Date('2026-01-01T00:00:00Z');
      const entries: OdometerEntry[] = [
        {
          id: 'entry-old',
          occurred_at: new Date(baseDate.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
          mileage_km: 150000,
          note: null,
          created_at: new Date(baseDate.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'entry-new',
          occurred_at: baseDate.toISOString(),
          mileage_km: 151000,
          note: null,
          created_at: baseDate.toISOString(),
        },
      ];
      entries.reverse();
      
      // When: estimate daily rate
      const result = estimateDailyKmRate(entries);
      
      // Then: should use fallback (window too large)
      expect(result.dailyKmRate).toBe(30);
      expect(result.isFallback).toBe(true);
    });

    it('should use custom fallback when provided', () => {
      // Given: no entries with custom fallback
      const entries: OdometerEntry[] = [];
      
      // When: estimate with custom fallback
      const result = estimateDailyKmRate(entries, { fallbackDailyKm: 50 });
      
      // Then: should use custom fallback
      expect(result.dailyKmRate).toBe(50);
      expect(result.isFallback).toBe(true);
    });
  });

  describe('estimateDaysToReachKm', () => {
    it('should calculate days to reach km using rate', () => {
      // Given: remainingKm=150, dailyKmRate=50
      const remainingKm = 150;
      const dailyKmRate = 50;
      
      // When: estimate days
      const days = estimateDaysToReachKm(remainingKm, dailyKmRate);
      
      // Then: should be 3 (150/50 = 3, rounded up)
      expect(days).toBe(3);
    });

    it('should return 0 for null or negative remainingKm', () => {
      expect(estimateDaysToReachKm(null, 50)).toBe(0);
      expect(estimateDaysToReachKm(-100, 50)).toBe(0);
      expect(estimateDaysToReachKm(0, 50)).toBe(0);
    });

    it('should handle fractional days (round up)', () => {
      // Given: remainingKm=100, dailyKmRate=30 (100/30 = 3.33...)
      const days = estimateDaysToReachKm(100, 30);
      
      // Then: should round up to 4
      expect(days).toBe(4);
    });

    it('should use fallback when dailyKmRate <= 0', () => {
      // Given: invalid rate
      const days = estimateDaysToReachKm(150, 0);
      
      // Then: should use fallback calculation (150/30 = 5)
      expect(days).toBe(5);
    });

    it('should normalize near-zero values', () => {
      // Given: very small remainingKm
      const days = estimateDaysToReachKm(0.005, 50);
      
      // Then: should normalize to 0
      expect(days).toBe(0);
    });
  });
});

