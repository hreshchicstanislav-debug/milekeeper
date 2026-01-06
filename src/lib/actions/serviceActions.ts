'use server';

/**
 * Server-side actions for service items and service events
 * Uses admin client - server-only, never import in client components
 */

import { unstable_cache } from 'next/cache';
import { revalidateTag, revalidatePath } from 'next/cache';
import { createAdminClient } from '../supabase/adminClient';
import { getMaxMileageEntry } from './odometerActions';
import { TAGS } from '../cache/tags';
import type {
  ServiceItem,
  ServiceItemInput,
  ServiceItemUpdate,
  ServiceEvent,
  ServiceEventInput,
} from '../db/types';

/**
 * List active service items, ordered by title ascending
 * @returns Array of active service items
 */
async function _listServiceItems(): Promise<ServiceItem[]> {
  const supabase = createAdminClient();
  
  const { data, error } = await supabase
    .from('service_items')
    .select('*')
    .eq('is_active', true)
    .order('title', { ascending: true });
  
  if (error) {
    throw new Error(`Failed to list service items: ${error.message}`);
  }
  
  return data || [];
}

export const listServiceItems = unstable_cache(
  _listServiceItems,
  ['serviceItems'],
  {
    tags: [TAGS.serviceItems],
  }
);

/**
 * Create a new service item
 * @param input Service item data
 * @returns The inserted service item
 * @throws Error if neither intervalKm nor intervalDays is provided
 */
export async function createServiceItem(
  input: ServiceItemInput
): Promise<ServiceItem> {
  // Validate measurementMode
  if (!input.measurementMode || (input.measurementMode !== 'km' && input.measurementMode !== 'calendar')) {
    throw new Error('Режим контроля обязателен и должен быть "km" или "calendar"');
  }
  
  // Validate: interval must be provided based on measurement mode
  if (input.measurementMode === 'km') {
    if (input.intervalKm === null || input.intervalKm === undefined || input.intervalKm <= 0) {
      throw new Error('Для режима "по пробегу" необходимо указать интервал в километрах');
    }
  } else if (input.measurementMode === 'calendar') {
    if (input.intervalDays === null || input.intervalDays === undefined || input.intervalDays <= 0) {
      throw new Error('Для режима "по календарю" необходимо указать интервал в днях');
    }
  }
  
  // Validate notify thresholds: notifyBeforeDays required, notifyBeforeKm optional (removed from UI)
  if (input.notifyBeforeDays === undefined || input.notifyBeforeDays === null) {
    throw new Error('Поле «Уведомлять за, дней» обязательно');
  }
  if (typeof input.notifyBeforeDays !== 'number' || input.notifyBeforeDays <= 0 || !Number.isInteger(input.notifyBeforeDays)) {
    throw new Error('Поле «Уведомлять за, дней» должно быть положительным целым числом');
  }
  if (input.notifyBeforeDays > 365) {
    throw new Error('Поле «Уведомлять за, дней» не должно превышать 365 дней');
  }
  
  // notifyBeforeKm is optional (removed from UI, always null)
  // If provided, validate it, but it's not required
  if (input.notifyBeforeKm !== undefined && input.notifyBeforeKm !== null) {
    if (typeof input.notifyBeforeKm !== 'number' || input.notifyBeforeKm <= 0 || !Number.isInteger(input.notifyBeforeKm)) {
      throw new Error('Поле «Уведомлять за, км» должно быть положительным целым числом');
    }
  }
  
  const supabase = createAdminClient();
  
  const { data, error } = await supabase
    .from('service_items')
    .insert({
      title: input.title,
      interval_km: input.intervalKm ?? null,
      interval_days: input.intervalDays ?? null,
      notify_before_days: input.notifyBeforeDays,
      notify_before_km: input.notifyBeforeKm ?? null, // Always null (removed from UI)
      measurement_mode: input.measurementMode,
      note: input.note || null,
      is_active: true,
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to create service item: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('Failed to create service item: No data returned');
  }
  
  // Invalidate cache tags after successful creation
  revalidateTag(TAGS.serviceItems, 'max');
  revalidateTag(TAGS.serviceEvents, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  revalidateTag(TAGS.odometer, 'max'); // Service items depend on odometer data
  
  // Also revalidate paths to ensure immediate UI update
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  revalidatePath('/items', 'page');
  revalidatePath('/items', 'layout'); // This invalidates all /items/* dynamic routes
  
  // Dev-only: log cache invalidation
  if (process.env.NODE_ENV !== 'production') {
    console.log('[createServiceItem] Revalidated tags: serviceItems, serviceEvents, home, items');
  }
  
  return data;
}

/**
 * Update a service item
 * @param id Service item ID
 * @param patch Partial update data
 * @returns The updated service item
 * @throws Error if update would violate the interval constraint
 */
export async function updateServiceItem(
  id: string,
  patch: ServiceItemUpdate
): Promise<ServiceItem> {
  const supabase = createAdminClient();
  
  // Validate title if provided
  if (patch.title !== undefined) {
    const trimmedTitle = patch.title.trim();
    if (trimmedTitle.length === 0) {
      throw new Error('Название обязательно');
    }
  }
  
  // First, get the current item to validate the constraint
  const { data: current, error: fetchError } = await supabase
    .from('service_items')
    .select('*')
    .eq('id', id)
    .single();
  
  if (fetchError) {
    throw new Error(`Не удалось получить элемент: ${fetchError.message}`);
  }
  
  if (!current) {
    throw new Error(`Элемент не найден: ${id}`);
  }
  
  // Determine the new measurement mode (use current if not provided)
  const newMeasurementMode = patch.measurementMode !== undefined ? patch.measurementMode : current.measurement_mode;
  
  // Validate measurement mode
  if (newMeasurementMode !== 'km' && newMeasurementMode !== 'calendar') {
    throw new Error('Режим контроля должен быть "km" или "calendar"');
  }
  
  // Determine the new interval values
  const newIntervalKm = patch.intervalKm !== undefined ? patch.intervalKm : current.interval_km;
  const newIntervalDays = patch.intervalDays !== undefined ? patch.intervalDays : current.interval_days;
  
  // Validate: interval must be provided based on measurement mode
  if (newMeasurementMode === 'km') {
    if (newIntervalKm === null || newIntervalKm === undefined || newIntervalKm <= 0) {
      throw new Error('Для режима "по пробегу" необходимо указать интервал в километрах');
    }
    // intervalDays is optional for km mode (can be null or > 0)
  } else if (newMeasurementMode === 'calendar') {
    if (newIntervalDays === null || newIntervalDays === undefined || newIntervalDays <= 0) {
      throw new Error('Для режима "по календарю" необходимо указать интервал в днях');
    }
    // intervalKm is optional for calendar mode (can be null or > 0)
  }
  
  // Validate: intervals must be positive if provided
  if (newIntervalKm !== null && newIntervalKm !== undefined && newIntervalKm <= 0) {
    throw new Error('Интервал в километрах должен быть положительным числом');
  }
  
  if (newIntervalDays !== null && newIntervalDays !== undefined && newIntervalDays <= 0) {
    throw new Error('Интервал в днях должен быть положительным числом');
  }
  
  // Validate notify thresholds if provided
  if (patch.notifyBeforeDays !== undefined) {
    if (patch.notifyBeforeDays === null || typeof patch.notifyBeforeDays !== 'number' || patch.notifyBeforeDays <= 0 || !Number.isInteger(patch.notifyBeforeDays)) {
      throw new Error('Поле «Уведомлять за, дней» должно быть положительным целым числом');
    }
    if (patch.notifyBeforeDays > 365) {
      throw new Error('Поле «Уведомлять за, дней» не должно превышать 365 дней');
    }
  }
  
  // notifyBeforeKm is optional (removed from UI, always null)
  // If provided, validate it, but it's not required
  if (patch.notifyBeforeKm !== undefined && patch.notifyBeforeKm !== null) {
    if (typeof patch.notifyBeforeKm !== 'number' || patch.notifyBeforeKm <= 0 || !Number.isInteger(patch.notifyBeforeKm)) {
      throw new Error('Поле «Уведомлять за, км» должно быть положительным целым числом');
    }
  }
  
  // Determine new notify threshold values (use current if not provided)
  const newNotifyBeforeDays = patch.notifyBeforeDays !== undefined ? patch.notifyBeforeDays : current.notify_before_days;
  const newNotifyBeforeKm = patch.notifyBeforeKm !== undefined ? patch.notifyBeforeKm : (current.notify_before_km ?? null);
  
  // Build update object
  const updateData: Record<string, unknown> = {};
  if (patch.title !== undefined) updateData.title = patch.title.trim();
  if (patch.intervalKm !== undefined) updateData.interval_km = patch.intervalKm;
  if (patch.intervalDays !== undefined) updateData.interval_days = patch.intervalDays;
  if (patch.notifyBeforeDays !== undefined) updateData.notify_before_days = patch.notifyBeforeDays;
  if (patch.notifyBeforeKm !== undefined) updateData.notify_before_km = patch.notifyBeforeKm;
  if (patch.measurementMode !== undefined) updateData.measurement_mode = patch.measurementMode;
  if (patch.note !== undefined) updateData.note = patch.note;
  if (patch.isActive !== undefined) updateData.is_active = patch.isActive;
  
  const { data, error } = await supabase
    .from('service_items')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    throw new Error(`Не удалось сохранить изменения: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('Не удалось сохранить изменения: данные не возвращены');
  }
  
  // Invalidate cache tags after successful update
  revalidateTag(TAGS.serviceItems, 'max');
  revalidateTag(TAGS.serviceEvents, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  revalidateTag(TAGS.odometer, 'max'); // Service items depend on odometer data
  
  // Also revalidate paths to ensure immediate UI update
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  revalidatePath('/items', 'page');
  revalidatePath('/items', 'layout'); // This invalidates all /items/* dynamic routes
  
  // Dev-only: log cache invalidation
  if (process.env.NODE_ENV !== 'production') {
    console.log('[updateServiceItem] Revalidated tags: serviceItems, serviceEvents, home, items');
  }
  
  return data;
}

/**
 * Delete a service item and all its service events
 * @param id Service item ID
 * @returns Success indicator
 * @throws Error if deletion fails
 */
export async function deleteServiceItem(id: string): Promise<{ success: boolean }> {
  const supabase = createAdminClient();

  // First, delete all service events for this item (for safety, even if FK cascade is set)
  const { error: eventsError } = await supabase
    .from('service_events')
    .delete()
    .eq('service_item_id', id);

  if (eventsError) {
    throw new Error(`Не удалось удалить события обслуживания: ${eventsError.message}`);
  }

  // Then delete the service item
  const { error: itemError } = await supabase
    .from('service_items')
    .delete()
    .eq('id', id);

  if (itemError) {
    throw new Error(`Не удалось удалить элемент обслуживания: ${itemError.message}`);
  }

  // Invalidate cache tags after successful deletion
  revalidateTag(TAGS.serviceItems, 'max');
  revalidateTag(TAGS.serviceEvents, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  revalidateTag(TAGS.odometer, 'max'); // Service items depend on odometer data
  
  // Also revalidate paths to ensure immediate UI update
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  revalidatePath('/items', 'page');
  revalidatePath('/items', 'layout'); // This invalidates all /items/* dynamic routes
  
  // Dev-only: log cache invalidation
  if (process.env.NODE_ENV !== 'production') {
    console.log('[deleteServiceItem] Revalidated tags: serviceItems, serviceEvents, home, items');
  }

  return { success: true };
}

/**
 * Add a new service event
 * @param input Service event data
 * @returns The inserted service event
 * @throws Error if mileageKm is missing or greater than latest odometer entry
 */
export async function addServiceEvent(
  input: ServiceEventInput
): Promise<ServiceEvent> {
  // Require mileageKm (auto-prognosis will be added later)
  if (input.mileageKm === undefined || input.mileageKm === null) {
    throw new Error('Mileage required');
  }
  
  const supabase = createAdminClient();
  
  // Fetch max mileage entry to validate mileage (matches what's shown on home page)
  const maxMileageEntry = await getMaxMileageEntry('AddServiceEvent');
  
  if (maxMileageEntry === null) {
    throw new Error('Сначала добавьте пробег (одометр)');
  }
  
  // Validate that service event mileage does not exceed current max odometer mileage
  if (input.mileageKm > maxMileageEntry.mileage_km) {
    throw new Error(
      `Пробег замены не может быть больше текущего пробега. ` +
      `Текущий пробег: ${maxMileageEntry.mileage_km} км, указано: ${input.mileageKm} км`
    );
  }
  
  // Insert the service event
  const { data, error } = await supabase
    .from('service_events')
    .insert({
      service_item_id: input.serviceItemId,
      occurred_at: input.occurredAt.toISOString(),
      mileage_km: input.mileageKm,
      note: input.note || null,
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to add service event: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('Failed to add service event: No data returned');
  }
  
  // Invalidate cache tags after successful creation
  // Use 'max' revalidation type for aggressive cache clearing on Vercel
  revalidateTag(TAGS.serviceEvents, 'max');
  revalidateTag(TAGS.serviceItems, 'max'); // Also invalidate items cache
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  revalidateTag(TAGS.odometer, 'max'); // Service events depend on odometer data
  
  // Also revalidate paths to ensure immediate UI update
  // Revalidate all relevant paths to clear Next.js page cache
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  revalidatePath('/items', 'page');
  revalidatePath('/items', 'layout'); // This invalidates all /items/* dynamic routes
  
  return data;
}

/**
 * List service events for a specific service item, ordered by occurred_at descending
 * @param serviceItemId Service item ID
 * @returns Array of service events
 */
export async function listServiceEventsByItem(
  serviceItemId: string
): Promise<ServiceEvent[]> {
  const supabase = createAdminClient();
  
  const { data, error } = await supabase
    .from('service_events')
    .select('*')
    .eq('service_item_id', serviceItemId)
    .order('occurred_at', { ascending: false });
  
  if (error) {
    throw new Error(`Failed to list service events: ${error.message}`);
  }
  
  return data || [];
}

/**
 * Get the last service event for a specific service item
 * @param serviceItemId Service item ID
 * @returns Last service event or null if none exist
 */
export async function getLastServiceEventByItem(
  serviceItemId: string
): Promise<ServiceEvent | null> {
  const events = await listServiceEventsByItem(serviceItemId);
  return events.length > 0 ? events[0] : null;
}

/**
 * Get the last service event for multiple service items in a single SQL query
 * Uses DISTINCT ON to get only the latest event per service_item_id
 * @param itemIds Array of service item IDs
 * @returns Map of service_item_id to last service event (or null if none exists)
 */
async function _listLastServiceEventsForItems(
  itemIds: string[]
): Promise<Record<string, ServiceEvent | null>> {
  if (itemIds.length === 0) {
    return {};
  }

  const supabase = createAdminClient();

  // Use RPC to execute a SQL query with DISTINCT ON
  // This is more efficient than fetching all events and sorting in JS
  const { data: latestEvents, error } = await supabase.rpc('get_last_service_events_for_items', {
    item_ids: itemIds,
  });

  if (error) {
    // Fallback to optimized query if RPC doesn't exist (for backwards compatibility)
    // This should not happen in production, but provides safety during migration
    if (process.env.NODE_ENV !== 'production') {
      console.warn('RPC function get_last_service_events_for_items not found, using fallback:', error.message);
    }
    
    // Fallback: fetch with SQL-side sorting, then take first event per item in one pass
    // This is more efficient than the old JS grouping/sorting approach
    const { data: allEvents, error: fetchError } = await supabase
      .from('service_events')
      .select('*')
      .in('service_item_id', itemIds)
      .order('service_item_id', { ascending: true })
      .order('occurred_at', { ascending: false })
      .order('mileage_km', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to list service events: ${fetchError.message}`);
    }

    // Build result map - take first event for each service_item_id (already sorted by DB)
    // Single pass through events, no JS sorting needed
    const result: Record<string, ServiceEvent | null> = {};
    for (const itemId of itemIds) {
      result[itemId] = null;
    }

    const seenItems = new Set<string>();
    for (const event of allEvents || []) {
      if (!seenItems.has(event.service_item_id)) {
        result[event.service_item_id] = event;
        seenItems.add(event.service_item_id);
      }
    }

    return result;
  }

  // Build result map from RPC response
  const result: Record<string, ServiceEvent | null> = {};
  
  // Initialize all items to null
  for (const itemId of itemIds) {
    result[itemId] = null;
  }

  // Fill in returned events
  if (latestEvents && Array.isArray(latestEvents)) {
    for (const event of latestEvents) {
      if (event && event.service_item_id) {
        result[event.service_item_id] = event as ServiceEvent;
      }
    }
  }

  return result;
}

export async function listLastServiceEventsForItems(
  itemIds: string[]
): Promise<Record<string, ServiceEvent | null>> {
  if (itemIds.length === 0) {
    return {};
  }
  
  // Sort itemIds to ensure consistent cache key
  const sortedIds = [...itemIds].sort().join(',');
  return unstable_cache(
    () => _listLastServiceEventsForItems(itemIds),
    [`serviceEvents:lastForItems:${sortedIds}`],
    {
      tags: [TAGS.serviceEvents],
    }
  )();
}


