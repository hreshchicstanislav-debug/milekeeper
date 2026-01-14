import { describe, it, expect } from 'vitest';
import {
  shouldShowSoonMaintenanceBlock,
  pickSoonMaintenanceItems,
  formatSoonMaintenanceEta,
  DEFAULT_THRESHOLDS,
  type SoonMaintenanceItemInput,
} from '../soonMaintenance';

describe('soonMaintenance', () => {
  describe('shouldShowSoonMaintenanceBlock', () => {
    it('should return true if at least one item is overdue', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'km',
          status: 'OVERDUE',
          remainingKm: 500,
          remainingDays: 10,
          isOverdue: true,
        },
        {
          id: '2',
          title: 'Item 2',
          mode: 'km',
          status: 'OK',
          remainingKm: 5000,
          remainingDays: 100,
          isOverdue: false,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(true);
    });

    it('should return true for calendar mode item with days <= Y_days', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'calendar',
          status: 'SOON',
          remainingKm: null,
          remainingDays: 3, // <= 5 (Y_days default)
          isOverdue: false,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(true);
    });

    it('should use per-item notifyBeforeDays for calendar mode instead of global Y_days', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'calendar',
          status: 'SOON',
          remainingKm: null,
          remainingDays: 10, // > 5 (default Y_days) but <= 15 (item notifyBeforeDays)
          isOverdue: false,
          notifyBeforeDays: 15,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(true);
    });

    it('should use fallback Y_days when notifyBeforeDays is null/undefined for calendar mode', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'calendar',
          status: 'SOON',
          remainingKm: null,
          remainingDays: 3, // <= 5 (fallback Y_days)
          isOverdue: false,
          notifyBeforeDays: null,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(true);
    });

    it('should return false for calendar mode item with days > Y_days', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'calendar',
          status: 'OK',
          remainingKm: null,
          remainingDays: 10, // > 5 (Y_days)
          isOverdue: false,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(false);
    });

    it('should return true for mileage mode item with days <= threshold (km is not used)', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'km',
          status: 'SOON',
          remainingKm: 1000,
          remainingDays: 3, // <= 5 (Y_days default)
          isOverdue: false,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(true);
    });

    it('should return true for mileage mode item with days <= Y_days', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'km',
          status: 'SOON',
          remainingKm: 5000,
          remainingDays: 3, // <= 5 (Y_days default)
          isOverdue: false,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(true);
    });

    it('should use per-item notifyBeforeDays for mileage mode instead of global Y_days', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'km',
          status: 'SOON',
          remainingKm: 5000,
          remainingDays: 10, // > 5 (default Y_days) but <= 14 (item notifyBeforeDays)
          isOverdue: false,
          notifyBeforeDays: 14,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(true);
    });

    it('should use fallback Y_days when notifyBeforeDays is null/undefined for mileage mode', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'km',
          status: 'SOON',
          remainingKm: 5000,
          remainingDays: 3, // <= 5 (fallback Y_days)
          isOverdue: false,
          notifyBeforeDays: undefined,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(true);
    });

    it('should return false if no items qualify', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1',
          mode: 'km',
          status: 'OK',
          remainingKm: 5000,
          remainingDays: 20,
          isOverdue: false,
        },
      ];

      expect(shouldShowSoonMaintenanceBlock(items)).toBe(false);
    });
  });

  describe('pickSoonMaintenanceItems', () => {
    it('should filter and sort items correctly', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item OK',
          mode: 'km',
          status: 'OK',
          remainingKm: 5000,
          remainingDays: 20,
          isOverdue: false,
        },
        {
          id: '2',
          title: 'Item Soon',
          mode: 'km',
          status: 'SOON',
          remainingKm: 1000,
          remainingDays: 3,
          isOverdue: false,
        },
        {
          id: '3',
          title: 'Item Overdue',
          mode: 'km',
          status: 'OVERDUE',
          remainingKm: -100,
          remainingDays: -2,
          isOverdue: true,
        },
      ];

      const result = pickSoonMaintenanceItems(items);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('3'); // Overdue first
      expect(result[0].severity).toBe('OVERDUE');
      expect(result[0].statusLabel).toBe('Просрочено');
      expect(result[1].id).toBe('2'); // Soon second
      expect(result[1].severity).toBe('SOON');
      expect(result[1].statusLabel).toBe('');
    });

    it('should use per-item notifyBeforeDays for calendar mode eligibility', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item with custom threshold',
          mode: 'calendar',
          status: 'SOON',
          remainingKm: null,
          remainingDays: 10, // > 5 (default) but <= 15 (item threshold)
          isOverdue: false,
          notifyBeforeDays: 15,
        },
        {
          id: '2',
          title: 'Item with default threshold',
          mode: 'calendar',
          status: 'OK',
          remainingKm: null,
          remainingDays: 10, // > 5 (default), no custom threshold
          isOverdue: false,
        },
      ];

      const result = pickSoonMaintenanceItems(items);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1'); // Only item with custom threshold qualifies
    });

    it('should use per-item notifyBeforeDays for mileage mode eligibility', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item with custom threshold',
          mode: 'km',
          status: 'SOON',
          remainingKm: 5000, // > 1200 (X_km)
          remainingDays: 10, // > 5 (default) but <= 14 (item threshold)
          isOverdue: false,
          notifyBeforeDays: 14,
        },
        {
          id: '2',
          title: 'Item with default threshold',
          mode: 'km',
          status: 'OK',
          remainingKm: 5000,
          remainingDays: 10, // > 5 (default), no custom threshold
          isOverdue: false,
        },
      ];

      const result = pickSoonMaintenanceItems(items);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1'); // Only item with custom threshold qualifies
      expect(result[0].severity).toBe('SOON');
      expect(result[0].statusLabel).toBe('');
    });

    it('should limit to MAX_ITEMS', () => {
      const items: SoonMaintenanceItemInput[] = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
        mode: 'km' as const,
        status: 'SOON' as const,
        remainingKm: 1000,
        remainingDays: 3,
        isOverdue: false,
      }));

      const result = pickSoonMaintenanceItems(items);

      expect(result).toHaveLength(DEFAULT_THRESHOLDS.MAX_ITEMS);
    });

    it('should sort by remainingDays ascending (nearest first)', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 5 days',
          mode: 'km',
          status: 'SOON',
          remainingKm: 1000,
          remainingDays: 5,
          isOverdue: false,
          notifyBeforeDays: 14,
        },
        {
          id: '2',
          title: 'Item 2 days',
          mode: 'km',
          status: 'SOON',
          remainingKm: 1000,
          remainingDays: 2,
          isOverdue: false,
          notifyBeforeDays: 14,
        },
        {
          id: '3',
          title: 'Item 10 days',
          mode: 'km',
          status: 'SOON',
          remainingKm: 1000,
          remainingDays: 10,
          isOverdue: false,
          notifyBeforeDays: 14,
        },
      ];

      const result = pickSoonMaintenanceItems(items);

      expect(result[0].id).toBe('2'); // 2 days first
      expect(result[1].id).toBe('1'); // 5 days second
      expect(result[2].id).toBe('3'); // 10 days third
    });

    it('should use km as tie-breaker when days are equal', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item 1000 km',
          mode: 'km',
          status: 'SOON',
          remainingKm: 1000,
          remainingDays: 3,
          isOverdue: false,
        },
        {
          id: '2',
          title: 'Item 500 km',
          mode: 'km',
          status: 'SOON',
          remainingKm: 500,
          remainingDays: 3,
          isOverdue: false,
        },
      ];

      const result = pickSoonMaintenanceItems(items);

      expect(result[0].id).toBe('2'); // 500 km first (nearest)
      expect(result[1].id).toBe('1'); // 1000 km second
    });

    it('should exclude mileage-mode items with missing remainingDays (insufficient data)', () => {
      const items: SoonMaintenanceItemInput[] = [
        {
          id: '1',
          title: 'Item with days',
          mode: 'km',
          status: 'SOON',
          remainingKm: 1000,
          remainingDays: 3,
          isOverdue: false,
        },
        {
          id: '2',
          title: 'Item without days',
          mode: 'km',
          status: 'SOON',
          remainingKm: 500,
          remainingDays: null, // Missing
          isOverdue: false,
        },
      ];

      const result = pickSoonMaintenanceItems(items);

      expect(result.map(r => r.id)).toEqual(['1']);
    });
  });

  describe('formatSoonMaintenanceEta', () => {
    it('should format calendar mode: days only, no ~, no km', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Calendar Item',
        mode: 'calendar',
        status: 'SOON',
        remainingKm: null,
        remainingDays: 14,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('14 дней');
    });

    it('should format calendar mode with singular day', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Calendar Item',
        mode: 'calendar',
        status: 'SOON',
        remainingKm: null,
        remainingDays: 1,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('1 день');
    });

    it('should format calendar mode with plural days (2-4)', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Calendar Item',
        mode: 'calendar',
        status: 'SOON',
        remainingKm: null,
        remainingDays: 3,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('3 дня');
    });

    it('should format mileage mode: days with ~ and km in parentheses', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Mileage Item',
        mode: 'km',
        status: 'SOON',
        remainingKm: 1200,
        remainingDays: 5,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('~5 дней (1 200 км)');
    });

    it('should format mileage mode: only km if days missing', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Mileage Item',
        mode: 'km',
        status: 'SOON',
        remainingKm: 1200,
        remainingDays: null,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('(1 200 км)');
    });

    it('should format mileage mode: only days if km missing', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Mileage Item',
        mode: 'km',
        status: 'SOON',
        remainingKm: null,
        remainingDays: 5,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('~5 дней');
    });

    it('should format number with spaces (thousands separator)', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Mileage Item',
        mode: 'km',
        status: 'SOON',
        remainingKm: 12345,
        remainingDays: 5,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('~5 дней (12 345 км)');
    });

    it('should round days to integer', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Mileage Item',
        mode: 'km',
        status: 'SOON',
        remainingKm: 1200,
        remainingDays: 5.7,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('~6 дней (1 200 км)');
    });

    it('should round km to integer', () => {
      const item: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Mileage Item',
        mode: 'km',
        status: 'SOON',
        remainingKm: 1234.7,
        remainingDays: 5,
        isOverdue: false,
      };

      expect(formatSoonMaintenanceEta(item)).toBe('~5 дней (1 235 км)');
    });

    it('should return empty string for overdue items (no negative values)', () => {
      const overdueCalendar: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Overdue Calendar',
        mode: 'calendar',
        status: 'OVERDUE',
        remainingKm: null,
        remainingDays: -5,
        isOverdue: true,
      };

      const overdueMileage: SoonMaintenanceItemInput = {
        id: '2',
        title: 'Overdue Mileage',
        mode: 'km',
        status: 'OVERDUE',
        remainingKm: -200,
        remainingDays: -10,
        isOverdue: true,
      };

      expect(formatSoonMaintenanceEta(overdueCalendar)).toBe('');
      expect(formatSoonMaintenanceEta(overdueMileage)).toBe('');
    });

    it('should not show negative values even if not explicitly overdue', () => {
      const negativeDays: SoonMaintenanceItemInput = {
        id: '1',
        title: 'Negative Days',
        mode: 'km',
        status: 'SOON',
        remainingKm: 500,
        remainingDays: -2,
        isOverdue: false,
      };

      const negativeKm: SoonMaintenanceItemInput = {
        id: '2',
        title: 'Negative Km',
        mode: 'km',
        status: 'SOON',
        remainingKm: -100,
        remainingDays: 5,
        isOverdue: false,
      };

      // Should only show non-negative values
      expect(formatSoonMaintenanceEta(negativeDays)).toBe('(500 км)');
      expect(formatSoonMaintenanceEta(negativeKm)).toBe('~5 дней');
    });
  });
});

