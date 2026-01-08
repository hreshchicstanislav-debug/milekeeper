/**
 * datetime-local Input/Output Helpers
 * 
 * Provides correct timezone handling for HTML5 datetime-local inputs.
 * 
 * Problem: HTML5 datetime-local inputs expect/return local time strings (YYYY-MM-DDTHH:mm),
 * but JavaScript's Date constructor and toISOString() work with UTC.
 * 
 * Solution: Use explicit local timezone methods to convert between Date objects and
 * datetime-local strings, ensuring user-entered local time is preserved.
 */

/**
 * Convert a Date object to datetime-local input value (YYYY-MM-DDTHH:mm)
 * 
 * Uses local timezone methods to ensure the displayed time matches the Date's local time.
 * 
 * @param date Date object (can be in any timezone, will use its local representation)
 * @returns String in format "YYYY-MM-DDTHH:mm" representing local time
 * 
 * @example
 * // If date represents 2025-01-02 14:30 in local timezone (UTC+3)
 * // Returns "2025-01-02T14:30" (not UTC equivalent)
 * toDateTimeLocalValue(new Date('2025-01-02T11:30:00Z')) // in UTC+3 → "2025-01-02T14:30"
 */
export function toDateTimeLocalValue(date: Date): string {
  // Use local timezone methods to extract components
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() is 0-indexed
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Parse a datetime-local input value (YYYY-MM-DDTHH:mm) as LOCAL time
 * 
 * Creates a Date object representing the given local time (not UTC).
 * 
 * @param value String in format "YYYY-MM-DDTHH:mm" (local time, no timezone)
 * @returns Date object representing the local time (will be converted to UTC internally by Date)
 * 
 * @example
 * // User enters "2025-01-02T14:30" in UTC+3 timezone
 * // Returns Date object for 2025-01-02 14:30 local time (stored as UTC 11:30 internally)
 * fromDateTimeLocalValue("2025-01-02T14:30") // in UTC+3 → Date(2025-01-02T11:30:00Z)
 */
export function fromDateTimeLocalValue(value: string): Date {
  // Parse the datetime-local string format: YYYY-MM-DDTHH:mm
  // Use Date constructor with explicit local time components
  // This ensures the time is interpreted as LOCAL time, not UTC
  
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid datetime-local format: ${value}. Expected YYYY-MM-DDTHH:mm`);
  }
  
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // Date constructor expects 0-indexed month
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  
  // Create Date using local timezone constructor
  // This Date object will internally store UTC equivalent, but represents the local time
  const date = new Date(year, month, day, hour, minute);
  
  // Validate the date was created correctly
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date components: ${value}`);
  }
  
  return date;
}

