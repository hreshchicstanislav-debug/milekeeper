'use server';

/**
 * Server-side actions for service items and service events
 * Uses user-scoped client (RLS)
 */

import { revalidateTag, revalidatePath } from 'next/cache';
import { getRlsClientAndUserId } from '../supabase/rlsServerClient';
import { getMaxMileageEntry } from './odometerActions';
import { TAGS } from '../cache/tags';
import type {
  ServiceItem,
  ServiceItemInput,
  ServiceItemUpdate,
  ServiceEvent,
  ServiceEventInput,
} from '../db/types';
import {
  isReplacementEvent,
  isServiceEventKind,
  isValidAmountLiters,
  SERVICE_EVENT_NOTE_MAX_LENGTH,
} from '../service/serviceEventKinds';
import { UUID_PATTERN } from '../service/historyPage';

/**
 * List active service items, ordered by title ascending
 * @returns Array of active service items
 */
async function fetchServiceItemsForCurrentUser(): Promise<{ userId: string; items: ServiceItem[] }> {
  const { supabase, userId } = await getRlsClientAndUserId(); // dynamic (reads cookies inside)
  
  const { data, error } = await supabase
    .from('service_items')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('title', { ascending: true });
  
  if (error) {
    throw new Error(`Failed to list service items: ${error.message}`);
  }
  
  return { userId, items: data || [] };
}

function computeServiceItems(items: ServiceItem[]): ServiceItem[] {
  // Pure post-processing (currently identity; ordering is handled by SQL query)
  return items;
}

export async function listServiceItems(): Promise<ServiceItem[]> {
  // Fetch is dynamic (RLS cookies) -> must NOT be inside unstable_cache()
  const { items } = await fetchServiceItemsForCurrentUser();
  return computeServiceItems(items);
}

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
  
  const { supabase, userId } = await getRlsClientAndUserId();
  
  const { data, error } = await supabase
    .from('service_items')
    .insert({
      user_id: userId,
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
  const { supabase, userId } = await getRlsClientAndUserId();
  
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
    .eq('user_id', userId)
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
    .eq('user_id', userId)
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
  const { supabase, userId } = await getRlsClientAndUserId();

  // First, delete all service events for this item (for safety, even if FK cascade is set)
  const { error: eventsError } = await supabase
    .from('service_events')
    .delete()
    .eq('service_item_id', id)
    .eq('user_id', userId);

  if (eventsError) {
    throw new Error(`Не удалось удалить события обслуживания: ${eventsError.message}`);
  }

  // Then delete the service item
  const { error: itemError } = await supabase
    .from('service_items')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

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
 * Expected outcomes of `addServiceEvent`. Rejections are returned as values, not thrown:
 * Next.js replaces the message of an error thrown from a Server Action with a generic
 * one in production, so the form could not explain the rejection otherwise.
 * Unexpected failures (session, database) still throw a generic error without details.
 */
export type AddServiceEventResult =
  | { ok: true; event: ServiceEvent }
  /** Malformed kind, date, mileage or comment. */
  | { ok: false; reason: 'invalid-input' }
  /** Volume given for a kind other than top-up, or outside 0 < value <= 99.99 (2 decimals). */
  | { ok: false; reason: 'invalid-amount' }
  | { ok: false; reason: 'item-unavailable' }
  | { ok: false; reason: 'no-odometer' }
  /**
   * Mileage is above the latest recorded odometer reading. The record is not saved; the
   * odometer has to be updated first (a separate operation).
   */
  | { ok: false; reason: 'mileage-above-odometer'; odometerKm: number; odometerAt: string };

export type AddServiceEventRejection = Extract<AddServiceEventResult, { ok: false }>;

/** Message of the DB trigger `milekeeper_enforce_service_event_mileage_not_future`. */
const DB_SERVICE_MILEAGE_TRIGGER_ERROR = 'не может быть больше текущего пробега';

function revalidateServiceData() {
  // Use 'max' revalidation type for aggressive cache clearing on Vercel
  revalidateTag(TAGS.serviceEvents, 'max');
  revalidateTag(TAGS.serviceItems, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  revalidateTag(TAGS.odometer, 'max'); // Forecasts combine service events with odometer data

  // Also revalidate paths so the current route re-renders with the action result
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  revalidatePath('/items', 'page');
  revalidatePath('/items', 'layout'); // This invalidates all /items/* dynamic routes
}

/**
 * Record a replacement, check or top-up for one of the current user's items.
 *
 * Never writes the odometer: the mileage must not exceed the latest recorded reading,
 * otherwise the user updates the odometer separately and saves again.
 * Only `kind = 'replacement'` starts a new interval (see `listLastServiceEventsForItems`).
 */
export async function addServiceEvent(
  input: ServiceEventInput
): Promise<AddServiceEventResult> {
  const note = typeof input?.note === 'string' ? input.note.trim() : input?.note ?? null;
  if (
    !input || typeof input.serviceItemId !== 'string' || !UUID_PATTERN.test(input.serviceItemId) ||
    !isServiceEventKind(input.kind) ||
    !(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime()) ||
    typeof input.mileageKm !== 'number' || !Number.isInteger(input.mileageKm) || input.mileageKm <= 0 ||
    (note !== null && (typeof note !== 'string' || note.length > SERVICE_EVENT_NOTE_MAX_LENGTH))
  ) {
    return { ok: false, reason: 'invalid-input' };
  }
  const amountLiters = input.amountLiters ?? null;
  if (amountLiters !== null && (input.kind !== 'top_up' || !isValidAmountLiters(amountLiters))) {
    return { ok: false, reason: 'invalid-amount' };
  }

  const { supabase, userId } = await getRlsClientAndUserId();

  // Reject unavailable items before inserting. The composite database FK is
  // the final guarantee, including when an item changes after this lookup.
  const { data: item, error: itemError } = await supabase
    .from('service_items')
    .select('id')
    .eq('id', input.serviceItemId)
    .eq('user_id', userId)
    .maybeSingle();

  if (itemError) {
    console.error('[addServiceEvent] Item lookup failed:', itemError);
    throw new Error('Не удалось сохранить запись');
  }
  if (!item) {
    return { ok: false, reason: 'item-unavailable' };
  }

  // Latest recorded odometer reading (the maximum, as shown in the form and on Home)
  const maxMileageEntry = await getMaxMileageEntry('AddServiceEvent');
  if (maxMileageEntry === null) {
    return { ok: false, reason: 'no-odometer' };
  }
  if (input.mileageKm > maxMileageEntry.mileage_km) {
    return {
      ok: false, reason: 'mileage-above-odometer',
      odometerKm: maxMileageEntry.mileage_km, odometerAt: maxMileageEntry.occurred_at,
    };
  }

  const { data, error } = await supabase
    .from('service_events')
    .insert({
      user_id: userId,
      service_item_id: input.serviceItemId,
      kind: input.kind,
      occurred_at: input.occurredAt.toISOString(),
      mileage_km: input.mileageKm,
      amount_liters: input.kind === 'top_up' ? amountLiters : null,
      note: note || null,
    })
    .select()
    .single();

  if (error) {
    // A reading deleted concurrently (another tab or device) can still trip the DB trigger.
    if (error.message?.includes(DB_SERVICE_MILEAGE_TRIGGER_ERROR)) {
      const latest = await getMaxMileageEntry('AddServiceEvent:retry');
      if (latest === null) return { ok: false, reason: 'no-odometer' };
      return { ok: false, reason: 'mileage-above-odometer', odometerKm: latest.mileage_km, odometerAt: latest.occurred_at };
    }
    // FK violation: the item was deleted or changed owner after the lookup above.
    if (error.code === '23503') {
      return { ok: false, reason: 'item-unavailable' };
    }
    console.error('[addServiceEvent] Insert failed:', error);
    throw new Error('Не удалось сохранить запись');
  }

  if (!data) {
    throw new Error('Не удалось сохранить запись');
  }

  revalidateServiceData();
  return { ok: true, event: data };
}

export type DeleteServiceEventResult =
  | { ok: true; deleted: Pick<ServiceEvent, 'id' | 'kind' | 'service_item_id'> }
  | { ok: false; reason: 'invalid-input' }
  /** Missing, already deleted, or owned by another user (indistinguishable on purpose). */
  | { ok: false; reason: 'not-found' };

/**
 * Delete one erroneous history record of the current user.
 *
 * The last replacement, forecasts and intervals are always derived from the remaining
 * records, so they are recomputed on the next render. The odometer is not touched.
 */
export async function deleteServiceEvent(eventId: string): Promise<DeleteServiceEventResult> {
  if (typeof eventId !== 'string' || !UUID_PATTERN.test(eventId)) {
    return { ok: false, reason: 'invalid-input' };
  }

  const { supabase, userId } = await getRlsClientAndUserId();

  // Explicit owner filter; RLS (`service_events_delete_own`) enforces it again.
  const { data, error } = await supabase
    .from('service_events')
    .delete()
    .eq('id', eventId)
    .eq('user_id', userId)
    .select('id, kind, service_item_id');

  if (error) {
    console.error('[deleteServiceEvent] Delete failed:', error);
    throw new Error('Не удалось удалить запись');
  }
  const deleted = data?.[0];
  if (!deleted) {
    return { ok: false, reason: 'not-found' };
  }

  revalidateServiceData();
  return { ok: true, deleted };
}

/**
 * Last *replacement* per service item (checks and top-ups are ignored).
 * @param itemIds Array of service item IDs
 * @returns Map of service_item_id to the last replacement (or null if none exists)
 */
async function _listLastServiceEventsForItems(
  itemIds: string[]
): Promise<Record<string, ServiceEvent | null>> {
  if (itemIds.length === 0) {
    return {};
  }

  const { supabase, userId } = await getRlsClientAndUserId();

  // User-scoped query under RLS. Only replacements start an interval: a later check or
  // top-up must never become the "last service" that forecasts are computed from.
  const { data: allEvents, error: fetchError } = await supabase
    .from('service_events')
    .select('*')
    .eq('user_id', userId)
    .in('service_item_id', itemIds)
    .eq('kind', 'replacement')
    .order('service_item_id', { ascending: true })
    .order('occurred_at', { ascending: false })
    .order('mileage_km', { ascending: false })
    .order('id', { ascending: false });

  if (fetchError) {
    throw new Error(`Failed to list service events: ${fetchError.message}`);
  }

  return computeLastServiceEventsMap(itemIds, allEvents || []);
}

export async function listLastServiceEventsForItems(
  itemIds: string[]
): Promise<Record<string, ServiceEvent | null>> {
  if (itemIds.length === 0) {
    return {};
  }

  // Fetch is dynamic (RLS cookies) -> must NOT be inside unstable_cache()
  return await _listLastServiceEventsForItems(itemIds);
}

function computeLastServiceEventsMap(
  itemIds: string[],
  allEvents: ServiceEvent[]
): Record<string, ServiceEvent | null> {
  // Pure post-processing: take first event per service_item_id from DB-sorted list.
  // The kind check repeats the query filter so a non-replacement can never slip through.
  const result: Record<string, ServiceEvent | null> = {};
  for (const itemId of itemIds) {
    result[itemId] = null;
  }

  const seenItems = new Set<string>();
  for (const event of allEvents) {
    if (!isReplacementEvent(event)) continue;
    if (!seenItems.has(event.service_item_id)) {
      result[event.service_item_id] = event;
      seenItems.add(event.service_item_id);
    }
  }

  return result;
}


