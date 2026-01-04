/**
 * Helper logic for Home "Soon Maintenance" block
 * Determines eligibility, selection, sorting, and formatting for maintenance items
 */

/**
 * Thresholds configuration for soon maintenance eligibility
 */
export interface SoonMaintenanceThresholds {
  /** Maximum remaining km to qualify (for mileage mode) */
  X_km: number;
  /** Maximum remaining days to qualify */
  Y_days: number;
  /** Maximum number of items to show */
  MAX_ITEMS: number;
}

/**
 * Default thresholds
 */
export const DEFAULT_THRESHOLDS: SoonMaintenanceThresholds = {
  X_km: 1200,
  Y_days: 5,
  MAX_ITEMS: 5,
};

/**
 * Input type for soon maintenance computation
 * Minimal fields needed for logic (tolerant to missing values)
 */
export interface SoonMaintenanceItemInput {
  id: string;
  title: string;
  /** Measurement mode: 'km' for mileage-based, 'calendar' for time-based */
  mode: 'km' | 'calendar';
  /** Status: 'OVERDUE' | 'SOON' | 'OK' */
  status: 'OVERDUE' | 'SOON' | 'OK';
  /** Remaining kilometers (null if not applicable) */
  remainingKm: number | null;
  /** Remaining days (calendar days for calendar mode, predicted days for km mode) */
  remainingDays: number | null;
  /** Whether item is overdue */
  isOverdue: boolean;
  /** Per-item notify before days threshold (null/undefined uses fallback from thresholds) */
  notifyBeforeDays?: number | null;
}

/**
 * Output type for selected maintenance items (ready for UI)
 */
export interface SoonMaintenanceItem {
  id: string;
  title: string;
  /** Whether this is calendar mode (affects formatting) */
  isCalendarMode: boolean;
  /** Computed remaining days (normalized, null if unavailable) */
  computedRemainingDays: number | null;
  /** Computed remaining km (normalized, null if unavailable) */
  computedRemainingKm: number | null;
  /** Whether item is overdue */
  isOverdue: boolean;
  /** Formatted ETA string (ready for display) */
  eta: string;
  /** UI severity level: 'OVERDUE' | 'SOON' */
  severity: 'OVERDUE' | 'SOON';
  /** Status label for display (empty string if not overdue) */
  statusLabel: string;
}

/**
 * Determines if the "Soon Maintenance" block should be shown
 * @param items Array of service items with status
 * @param thresholds Thresholds configuration
 * @returns true if at least one item qualifies
 */
export function shouldShowSoonMaintenanceBlock(
  items: SoonMaintenanceItemInput[],
  thresholds: SoonMaintenanceThresholds = DEFAULT_THRESHOLDS
): boolean {
  return items.some((item) => {
    // Always show overdue items
    if (item.isOverdue) {
      return true;
    }

    // Use per-item notifyBeforeDays with fallback to thresholds.Y_days
    const itemNotifyDays = item.notifyBeforeDays ?? thresholds.Y_days;

    // For calendar mode: use only remainingDays
    if (item.mode === 'calendar') {
      return item.remainingDays !== null && item.remainingDays <= itemNotifyDays;
    }

    // For mileage mode: can qualify by remainingKm OR remainingDays
    if (item.mode === 'km') {
      const qualifiesByKm = item.remainingKm !== null && item.remainingKm <= thresholds.X_km;
      const qualifiesByDays = item.remainingDays !== null && item.remainingDays <= itemNotifyDays;
      return qualifiesByKm || qualifiesByDays;
    }

    return false;
  });
}

/**
 * Selects and sorts qualifying maintenance items
 * @param items Array of service items with status
 * @param thresholds Thresholds configuration
 * @returns Array of selected items (max MAX_ITEMS), sorted and formatted
 */
export function pickSoonMaintenanceItems(
  items: SoonMaintenanceItemInput[],
  thresholds: SoonMaintenanceThresholds = DEFAULT_THRESHOLDS
): SoonMaintenanceItem[] {
  // Filter to only qualifying items
  const qualifying = items.filter((item) => {
    // Always include overdue items
    if (item.isOverdue) {
      return true;
    }

    // Use per-item notifyBeforeDays with fallback to thresholds.Y_days
    const itemNotifyDays = item.notifyBeforeDays ?? thresholds.Y_days;

    // For calendar mode: use only remainingDays
    if (item.mode === 'calendar') {
      return item.remainingDays !== null && item.remainingDays <= itemNotifyDays;
    }

    // For mileage mode: can qualify by remainingKm OR remainingDays
    if (item.mode === 'km') {
      const qualifiesByKm = item.remainingKm !== null && item.remainingKm <= thresholds.X_km;
      const qualifiesByDays = item.remainingDays !== null && item.remainingDays <= itemNotifyDays;
      return qualifiesByKm || qualifiesByDays;
    }

    return false;
  });

  // Sort: overdue first, then nearest by days (ascending), then by km (ascending) as tie-breaker
  qualifying.sort((a, b) => {
    // 1. OVERDUE first
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;

    // 2. Within same overdue status, sort by remainingDays (ascending - nearest first)
    const aDays = a.remainingDays ?? Infinity;
    const bDays = b.remainingDays ?? Infinity;
    if (aDays !== bDays) {
      return aDays - bDays;
    }

    // 3. Tie-breaker: by remainingKm (ascending - nearest first)
    const aKm = a.remainingKm ?? Infinity;
    const bKm = b.remainingKm ?? Infinity;
    if (aKm !== bKm) {
      return aKm - bKm;
    }

    // 4. Final tie-breaker: by title (alphabetical)
    return a.title.localeCompare(b.title, 'ru');
  });

  // Limit to MAX_ITEMS
  const selected = qualifying.slice(0, thresholds.MAX_ITEMS);

  // Format and return
  return selected.map((item) => {
    // Determine severity: OVERDUE if overdue, otherwise SOON
    const severity: 'OVERDUE' | 'SOON' = item.isOverdue ? 'OVERDUE' : 'SOON';
    // Status label: only show for overdue items
    const statusLabel = item.isOverdue ? 'Просрочено' : '';

    return {
      id: item.id,
      title: item.title,
      isCalendarMode: item.mode === 'calendar',
      computedRemainingDays: item.remainingDays,
      computedRemainingKm: item.remainingKm,
      isOverdue: item.isOverdue,
      eta: formatSoonMaintenanceEta(item),
      severity,
      statusLabel,
    };
  });
}

/**
 * Formats ETA string for a maintenance item
 * @param item Service item with status
 * @returns Formatted ETA string ready for display (empty string for overdue items)
 */
export function formatSoonMaintenanceEta(item: SoonMaintenanceItemInput): string {
  // IMPORTANT: Do not show negative values or ETA for overdue items
  // Overdue state is indicated by statusLabel ('Просрочено'), not by negative numbers
  if (item.isOverdue) {
    return ''; // No ETA shown for overdue items
  }

  // CALENDAR mode: show days only (no km), no '~' because days are exact
  if (item.mode === 'calendar') {
    if (item.remainingDays === null || item.remainingDays < 0) {
      return ''; // Should not happen for calendar mode, but safe fallback
    }
    const days = Math.round(item.remainingDays);
    return `${days} ${pluralizeDays(days)}`;
  }

  // MILEAGE mode: show days as forecast with '~' and km in parentheses on the SAME line
  const parts: string[] = [];

  // Add days if available (only if non-negative)
  if (item.remainingDays !== null && item.remainingDays >= 0) {
    const days = Math.round(item.remainingDays);
    parts.push(`~${days} ${pluralizeDays(days)}`);
  }

  // Add km if available (only if non-negative)
  if (item.remainingKm !== null && item.remainingKm >= 0) {
    const kmFormatted = formatNumberWithSpaces(item.remainingKm);
    if (parts.length > 0) {
      // If days are present, add km in parentheses on same line
      parts[0] = `${parts[0]} (${kmFormatted} км)`;
    } else {
      // If only km is present, show only km
      parts.push(`(${kmFormatted} км)`);
    }
  }

  return parts.join(' ');
}

/**
 * Pluralizes Russian word "день" based on count
 * @param count Number of days
 * @returns Correct plural form: "день", "дня", or "дней"
 */
function pluralizeDays(count: number): string {
  const absCount = Math.abs(count);
  const lastDigit = absCount % 10;
  const lastTwoDigits = absCount % 100;

  // Special cases for 11-14
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return 'дней';
  }

  // Cases for 1, 21, 31, etc.
  if (lastDigit === 1) {
    return 'день';
  }

  // Cases for 2-4, 22-24, 32-34, etc.
  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'дня';
  }

  // All other cases: 0, 5-9, 10, 15-20, 25-30, etc.
  return 'дней';
}

/**
 * Formats number with space as thousands separator (Russian locale style)
 * @param value Number to format
 * @returns Formatted string with spaces (e.g., 1200 -> "1 200")
 */
function formatNumberWithSpaces(value: number): string {
  // Round to integer for display
  const rounded = Math.round(value);
  
  // Convert to string and add spaces for thousands
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

