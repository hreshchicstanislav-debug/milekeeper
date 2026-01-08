'use client';

import { formatDateTimeRu } from '@/lib/ui/formatDateTimeRu';

/**
 * Client component for rendering ISO date strings in local timezone
 * 
 * Uses the existing formatDateTimeRu helper to ensure consistent formatting
 * across the application.
 * 
 * @example
 * <LocalDateTime iso="2025-01-02T14:30:00.000Z" />
 * <LocalDateTime iso={entry.occurred_at} fallback="Не указано" />
 */
interface LocalDateTimeProps {
  /**
   * ISO date string (or Date-compatible string) to format
   * Can be null or undefined - will render fallback in that case
   */
  iso: string | null | undefined;
  
  /**
   * Optional fallback text to show if iso is missing or invalid
   * Defaults to '—' if not provided
   */
  fallback?: string;
}

export function LocalDateTime({ iso, fallback = '—' }: LocalDateTimeProps) {
  // Handle missing or null/undefined values
  if (!iso) {
    return <>{fallback}</>;
  }

  // Validate and format the date
  try {
    const date = new Date(iso);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return <>{fallback}</>;
    }
    
    // Use existing formatter
    return <>{formatDateTimeRu(date)}</>;
  } catch (error) {
    // If parsing fails, show fallback
    return <>{fallback}</>;
  }
}

