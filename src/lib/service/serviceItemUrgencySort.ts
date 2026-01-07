/**
 * Service Item Urgency Sorting Helper
 * 
 * Implements sorting rules from docs/ui-status-visual-spec.md sections 9-14.
 * 
 * This module provides pure, deterministic sorting functions that work with
 * statusVM data (daysToReplace, isPredictionReliable, status) without
 * depending on React or UI components.
 */

/**
 * Urgency category for sorting
 * 
 * Categories are ordered by priority:
 * OVERDUE > SOON_RELIABLE > SOON_UNRELIABLE > OK > UNKNOWN
 */
export type UrgencyCategory = 'OVERDUE' | 'SOON_RELIABLE' | 'SOON_UNRELIABLE' | 'OK' | 'UNKNOWN';

/**
 * Metadata required for sorting
 */
export interface UrgencySortMeta {
  /** Status: 'OVERDUE' | 'SOON' | 'OK' | 'UNKNOWN' */
  status: string;
  /** Days until replacement (null if unavailable) */
  daysToReplace: number | null;
  /** Whether the prediction is reliable (for SOON status) */
  isPredictionReliable: boolean;
  /** Optional: item title or id for stable tie-breaking */
  titleOrId?: string;
}

/**
 * Categorize urgency based on status and prediction reliability
 * 
 * Rules (from spec section 10):
 * - OVERDUE: always OVERDUE category
 * - SOON: SOON_RELIABLE if isPredictionReliable, else SOON_UNRELIABLE
 * - OK: OK category
 * - UNKNOWN: UNKNOWN category
 * - If daysToReplace is null and status is SOON: treat as SOON_UNRELIABLE
 */
export function categorizeUrgency(meta: UrgencySortMeta): UrgencyCategory {
  const { status, daysToReplace, isPredictionReliable } = meta;
  
  if (status === 'OVERDUE') {
    return 'OVERDUE';
  }
  
  if (status === 'SOON') {
    // If daysToReplace is null, treat as unreliable
    if (daysToReplace === null) {
      return 'SOON_UNRELIABLE';
    }
    // Otherwise, use isPredictionReliable flag
    return isPredictionReliable ? 'SOON_RELIABLE' : 'SOON_UNRELIABLE';
  }
  
  if (status === 'OK') {
    return 'OK';
  }
  
  // Default: UNKNOWN (including status === 'UNKNOWN' or any other value)
  return 'UNKNOWN';
}

/**
 * Category priority for sorting (lower number = higher priority)
 */
const CATEGORY_PRIORITY: Record<UrgencyCategory, number> = {
  OVERDUE: 0,
  SOON_RELIABLE: 1,
  SOON_UNRELIABLE: 2,
  OK: 3,
  UNKNOWN: 4,
};

/**
 * Compare two items by urgency
 * 
 * Returns:
 * - negative if a should come before b (a is more urgent)
 * - positive if b should come before a (b is more urgent)
 * - 0 if equal
 * 
 * Sorting rules (from spec sections 10-13):
 * 1. Primary: Category priority (OVERDUE > SOON_RELIABLE > SOON_UNRELIABLE > OK > UNKNOWN)
 * 2. Secondary: Numeric urgency (daysToReplace ascending)
 *    - For OVERDUE: more negative = more urgent (smaller value = higher priority)
 *    - For SOON/OK: fewer days = more urgent (smaller value = higher priority)
 * 3. Tertiary: Stable tie-breaker (titleOrId string comparison)
 */
export function compareByUrgency(a: UrgencySortMeta, b: UrgencySortMeta): number {
  const categoryA = categorizeUrgency(a);
  const categoryB = categorizeUrgency(b);
  
  // Primary: Category priority
  const priorityA = CATEGORY_PRIORITY[categoryA];
  const priorityB = CATEGORY_PRIORITY[categoryB];
  
  if (priorityA !== priorityB) {
    return priorityA - priorityB; // Lower priority number = higher urgency
  }
  
  // Secondary: Numeric urgency (daysToReplace)
  const daysA = a.daysToReplace;
  const daysB = b.daysToReplace;
  
  // Handle null values: items with null days go after items with days
  if (daysA !== null && daysB !== null) {
    // Both have days: compare by value
    // For OVERDUE: more negative = more urgent (smaller value = higher priority)
    // For SOON/OK: fewer days = more urgent (smaller value = higher priority)
    if (daysA !== daysB) {
      return daysA - daysB; // Smaller value = more urgent
    }
  } else if (daysA !== null) {
    // A has days, B doesn't -> A is more urgent
    return -1;
  } else if (daysB !== null) {
    // B has days, A doesn't -> B is more urgent
    return 1;
  }
  // Both null: continue to tie-breaker
  
  // Tertiary: Stable tie-breaker (titleOrId string comparison)
  const titleA = a.titleOrId ?? '';
  const titleB = b.titleOrId ?? '';
  
  return titleA.localeCompare(titleB, 'ru');
}

/**
 * Sort items by urgency
 * 
 * @param items Array of items to sort
 * @param getMeta Function to extract urgency metadata from each item
 * @returns New sorted array (does not mutate input)
 */
export function sortByUrgency<T>(
  items: T[],
  getMeta: (item: T) => UrgencySortMeta
): T[] {
  // Create a copy to avoid mutating the input
  const sorted = [...items];
  
  // Sort using compareByUrgency
  sorted.sort((a, b) => {
    const metaA = getMeta(a);
    const metaB = getMeta(b);
    return compareByUrgency(metaA, metaB);
  });
  
  return sorted;
}

