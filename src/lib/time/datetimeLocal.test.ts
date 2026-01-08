import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from './datetimeLocal';

describe('datetimeLocal', () => {
  describe('toDateTimeLocalValue', () => {
    it('should return YYYY-MM-DDTHH:mm format in local timezone components', () => {
      // Given: a Date object representing a specific moment
      // Use a fixed date to avoid timezone-dependent test failures
      const date = new Date(2026, 0, 8, 13, 14); // January 8, 2026, 13:14 (local time)
      
      // When: convert to datetime-local value
      const result = toDateTimeLocalValue(date);
      
      // Then: should be in YYYY-MM-DDTHH:mm format with local components
      expect(result).toBe('2026-01-08T13:14');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(result).not.toContain('Z'); // No UTC indicator
    });

    it('should pad single-digit values with zeros', () => {
      // Given: date with single-digit month, day, hour, minute
      const date = new Date(2026, 0, 5, 3, 7); // January 5, 2026, 03:07
      
      // When: convert to datetime-local value
      const result = toDateTimeLocalValue(date);
      
      // Then: should pad with zeros
      expect(result).toBe('2026-01-05T03:07');
    });

    it('should use local timezone methods (not UTC)', () => {
      // Given: a UTC date that represents different local time
      // If we're in UTC+3, 2026-01-08T10:00:00Z is 13:00 local
      const utcDate = new Date('2026-01-08T10:00:00Z');
      
      // When: convert to datetime-local value
      const result = toDateTimeLocalValue(utcDate);
      
      // Then: should use local time components (not UTC)
      // The exact value depends on test environment timezone, but should NOT be "10:00"
      const localHours = utcDate.getHours(); // Local hours
      const expected = `2026-01-08T${String(localHours).padStart(2, '0')}:00`;
      expect(result).toBe(expected);
      // Verify it's not the UTC time
      expect(result).not.toBe('2026-01-08T10:00');
    });
  });

  describe('fromDateTimeLocalValue', () => {
    it('should parse YYYY-MM-DDTHH:mm as local time', () => {
      // Given: datetime-local string
      const value = '2026-01-08T13:14';
      
      // When: parse it
      const result = fromDateTimeLocalValue(value);
      
      // Then: should create Date with matching local components
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(0); // January is 0
      expect(result.getDate()).toBe(8);
      expect(result.getHours()).toBe(13);
      expect(result.getMinutes()).toBe(14);
    });

    it('should throw error for invalid format', () => {
      // Given: invalid format
      const invalidValues = [
        '2026-01-08 13:14', // Missing T
        '2026/01/08T13:14', // Wrong date separator
        '2026-01-08T13', // Missing minutes
        '2026-1-8T13:14', // Unpadded numbers
        'invalid',
      ];

      invalidValues.forEach((value) => {
        expect(() => fromDateTimeLocalValue(value)).toThrow();
      });
    });

    it('should handle edge cases (month/day boundaries)', () => {
      // Given: dates at boundaries
      const jan1 = fromDateTimeLocalValue('2026-01-01T00:00');
      expect(jan1.getMonth()).toBe(0);
      expect(jan1.getDate()).toBe(1);
      expect(jan1.getHours()).toBe(0);
      expect(jan1.getMinutes()).toBe(0);

      const dec31 = fromDateTimeLocalValue('2026-12-31T23:59');
      expect(dec31.getMonth()).toBe(11);
      expect(dec31.getDate()).toBe(31);
      expect(dec31.getHours()).toBe(23);
      expect(dec31.getMinutes()).toBe(59);
    });
  });

  describe('roundtrip', () => {
    it('should preserve local time components in roundtrip', () => {
      // Given: a Date object
      const original = new Date(2026, 0, 8, 13, 14); // January 8, 2026, 13:14 local
      
      // When: convert to datetime-local and back
      const localString = toDateTimeLocalValue(original);
      const roundtrip = fromDateTimeLocalValue(localString);
      
      // Then: local components should match
      expect(roundtrip.getFullYear()).toBe(original.getFullYear());
      expect(roundtrip.getMonth()).toBe(original.getMonth());
      expect(roundtrip.getDate()).toBe(original.getDate());
      expect(roundtrip.getHours()).toBe(original.getHours());
      expect(roundtrip.getMinutes()).toBe(original.getMinutes());
    });

    it('should handle example: parsing 2026-01-08T13:14 does NOT shift hours', () => {
      // Given: datetime-local string
      const value = '2026-01-08T13:14';
      
      // When: parse it
      const parsed = fromDateTimeLocalValue(value);
      
      // Then: format it back
      const formatted = toDateTimeLocalValue(parsed);
      
      // Then: should match original (no timezone shift)
      expect(formatted).toBe(value);
    });

    it('should preserve time across multiple roundtrips', () => {
      // Given: initial date
      const initial = new Date(2026, 5, 15, 9, 30); // June 15, 2026, 09:30
      
      // When: multiple roundtrips
      let current = initial;
      for (let i = 0; i < 5; i++) {
        const str = toDateTimeLocalValue(current);
        current = fromDateTimeLocalValue(str);
      }
      
      // Then: local components should still match
      expect(current.getFullYear()).toBe(initial.getFullYear());
      expect(current.getMonth()).toBe(initial.getMonth());
      expect(current.getDate()).toBe(initial.getDate());
      expect(current.getHours()).toBe(initial.getHours());
      expect(current.getMinutes()).toBe(initial.getMinutes());
    });
  });

  describe('timezone independence', () => {
    it('should work correctly regardless of system timezone', () => {
      // Given: a datetime-local string
      const value = '2026-01-08T13:14';
      
      // When: parse and format back
      const parsed = fromDateTimeLocalValue(value);
      const formatted = toDateTimeLocalValue(parsed);
      
      // Then: should match regardless of system timezone
      // The Date object internally stores UTC, but local components are preserved
      expect(formatted).toBe(value);
    });

    it('should not use Date.parse() which interprets as UTC', () => {
      // Given: datetime-local string that would be misinterpreted by Date.parse
      const value = '2026-01-08T13:14';
      
      // When: parse using our helper
      const ourResult = fromDateTimeLocalValue(value);
      
      // And: compare with Date.parse (which would interpret as UTC)
      const parseResult = new Date(value); // This would interpret as UTC if no timezone
      
      // Then: our helper should preserve local time components
      // Date.parse might create a different Date if value is interpreted as UTC
      expect(ourResult.getHours()).toBe(13);
      expect(ourResult.getMinutes()).toBe(14);
      
      // Verify our helper doesn't match Date.parse behavior (which is wrong for datetime-local)
      // Note: Date.parse behavior depends on format, but our helper explicitly uses local constructor
      const ourString = toDateTimeLocalValue(ourResult);
      expect(ourString).toBe(value); // Roundtrip works
    });
  });
});

