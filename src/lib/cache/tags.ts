/**
 * Cache tags for Next.js server-side caching
 * Used with unstable_cache and revalidateTag
 */

export const TAGS = {
  odometer: 'odometer',
  odometerEntries: 'odometerEntries',
  serviceItems: 'serviceItems',
  serviceEvents: 'serviceEvents',
  home: 'home',
  items: 'items',
} as const;

/**
 * Get cache tags for Home page data
 */
export function getHomeTags(): string[] {
  return [
    TAGS.odometer,
    TAGS.odometerEntries,
    TAGS.serviceItems,
    TAGS.serviceEvents,
    TAGS.home,
  ];
}

/**
 * Get cache tags for Items page data
 */
export function getItemsTags(): string[] {
  return [
    TAGS.odometer,
    TAGS.serviceItems,
    TAGS.serviceEvents,
    TAGS.items,
  ];
}

