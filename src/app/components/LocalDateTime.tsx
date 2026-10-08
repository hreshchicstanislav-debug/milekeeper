'use client';

import { useCopy, useHydrated } from '@/lib/i18n/client';

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
  dateOnly?: boolean;
}

export function LocalDateTime({ iso, fallback = '—', dateOnly = false }: LocalDateTimeProps) {
  const { displayDateTime, intlLocale } = useCopy();
  const hydrated = useHydrated();
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
    // The browser owns the display timezone. A stable SSR placeholder prevents
    // hydration from retaining a server-timezone value or remounting forms.
    return <time dateTime={date.toISOString()}>{hydrated
      ? dateOnly ? date.toLocaleDateString(intlLocale) : displayDateTime(date)
      : fallback}</time>;
  } catch (error) {
    // If parsing fails, show fallback
    return <>{fallback}</>;
  }
}

