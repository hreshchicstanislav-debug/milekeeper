'use server';

/**
 * Development-only server actions for seeding and testing MileKeeper data
 * Uses user-scoped client (RLS). Dev actions must never touch other users' data.
 */

import { revalidateTag, revalidatePath } from 'next/cache';
import { getRlsClientAndUserId } from '../supabase/rlsServerClient';
import { TAGS } from '../cache/tags';
import type { OdometerEntry, ServiceItem, ServiceEvent } from '../db/types';

interface SeedResult {
  serviceItems: number;
  odometerEntries: number;
  serviceEvents: number;
}

// Simple in-memory mutex for dev operations (prevents race conditions)
let isResetting = false;

/**
 * Helper: Find date for a given mileage by interpolating between odometer entries
 * @param entries Odometer entries sorted by mileage_km ascending
 * @param targetMileage Target mileage to find date for
 * @returns Date corresponding to target mileage
 */
function findDateForMileage(entries: OdometerEntry[], targetMileage: number): Date {
  if (entries.length === 0) {
    return new Date();
  }

  // If target is below first entry, use first entry's date
  if (targetMileage <= entries[0].mileage_km) {
    return new Date(entries[0].occurred_at);
  }

  // If target is above last entry, use last entry's date
  if (targetMileage >= entries[entries.length - 1].mileage_km) {
    return new Date(entries[entries.length - 1].occurred_at);
  }

  // Find surrounding entries and interpolate
  for (let i = 0; i < entries.length - 1; i++) {
    const prev = entries[i];
    const next = entries[i + 1];

    if (targetMileage >= prev.mileage_km && targetMileage <= next.mileage_km) {
      // Linear interpolation
      const mileageDiff = next.mileage_km - prev.mileage_km;
      const targetDiff = targetMileage - prev.mileage_km;
      const ratio = mileageDiff > 0 ? targetDiff / mileageDiff : 0;

      const prevDate = new Date(prev.occurred_at).getTime();
      const nextDate = new Date(next.occurred_at).getTime();
      const dateDiff = nextDate - prevDate;
      const interpolatedDate = prevDate + dateDiff * ratio;

      return new Date(interpolatedDate);
    }
  }

  // Fallback: use last entry's date
  return new Date(entries[entries.length - 1].occurred_at);
}

/**
 * Seed demo data: service items, odometer entries, and initial service events
 * 
 * Test procedure:
 * 1. Wipe -> Seed
 * 2. Open Home: 'Скоро замена' must show remaining km and time for items (no 'нет данных')
 * 3. Click 'Поездил неделю' a few times and confirm some items move from OK -> SOON -> OVERDUE
 * 
 * @param skipExistenceCheck If true, skip checking for existing data (used by resetAndSeedDemoData)
 * @returns Summary of inserted records
 * @throws Error if data already exists (unless skipExistenceCheck is true)
 */
export async function seedDemoData(skipExistenceCheck = false): Promise<SeedResult> {
  const { supabase, userId } = await getRlsClientAndUserId();

  // Check if data already exists (unless skipExistenceCheck is true)
  if (!skipExistenceCheck) {
    const { data: existingEntries } = await supabase
      .from('odometer_entries')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    const { data: existingItems } = await supabase
      .from('service_items')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if ((existingEntries && existingEntries.length > 0) || (existingItems && existingItems.length > 0)) {
      throw new Error('Демо-данные уже есть');
    }
  }

  // Insert service items with realistic intervals
  const serviceItemsData = [
    { user_id: userId, title: 'Масло двигателя', interval_km: 10000, interval_days: 180, notify_before_days: 14, notify_before_km: 1000, measurement_mode: 'km', note: null },
    { user_id: userId, title: 'Масляный фильтр', interval_km: 10000, interval_days: null, notify_before_days: 14, notify_before_km: 1000, measurement_mode: 'km', note: null },
    { user_id: userId, title: 'Воздушный фильтр', interval_km: 15000, interval_days: 365, notify_before_days: 30, notify_before_km: 1500, measurement_mode: 'km', note: null },
    { user_id: userId, title: 'Салонный фильтр', interval_km: 12000, interval_days: 365, notify_before_days: 30, notify_before_km: 1500, measurement_mode: 'km', note: null },
    { user_id: userId, title: 'Топливный фильтр', interval_km: 30000, interval_days: 730, notify_before_days: 30, notify_before_km: 1500, measurement_mode: 'km', note: null },
    { user_id: userId, title: 'Тормозная жидкость', interval_km: null, interval_days: 730, notify_before_days: 30, notify_before_km: 1000, measurement_mode: 'calendar', note: null },
    { user_id: userId, title: 'Антифриз', interval_km: 60000, interval_days: 1460, notify_before_days: 60, notify_before_km: 2000, measurement_mode: 'calendar', note: null },
  ];

  const { data: insertedItems, error: itemsError } = await supabase
    .from('service_items')
    .insert(serviceItemsData)
    .select();

  if (itemsError) {
    throw new Error(`Failed to insert service items: ${itemsError.message}`);
  }

  if (!insertedItems || insertedItems.length === 0) {
    throw new Error('Failed to insert service items: No data returned');
  }

  // Generate odometer entries for last ~90 days (20-35 entries)
  const now = new Date();
  const startMileage = 155000;
  const targetEndMileage = 160000; // Nice round number
  const daysBack = 90;
  const numEntries = 25 + Math.floor(Math.random() * 11); // 25-35 entries
  
  const entries: Array<{ user_id: string; occurred_at: string; mileage_km: number; note: string | null }> = [];
  
  let currentMileage = startMileage;
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - daysBack);

  // Calculate total mileage to cover
  const totalMileageDiff = targetEndMileage - startMileage;
  const avgDailyRate = totalMileageDiff / daysBack; // ~55 km/day average

  // Create entries with realistic spacing and mileage progression
  for (let i = 0; i < numEntries; i++) {
    const progress = i / (numEntries - 1); // 0 to 1
    const daysSinceStart = Math.round(progress * daysBack);
    const entryDate = new Date(startDate);
    entryDate.setDate(entryDate.getDate() + daysSinceStart);
    
    // Calculate target mileage for this entry (with small variation)
    const targetMileage = startMileage + Math.round(totalMileageDiff * progress);
    const variation = Math.round((Math.random() - 0.5) * 200); // ±100 km variation
    currentMileage = Math.max(currentMileage + 50, targetMileage + variation); // Ensure monotonic
    
    // Clamp to target end mileage
    if (i === numEntries - 1) {
      currentMileage = targetEndMileage;
    } else {
      currentMileage = Math.min(currentMileage, targetEndMileage - 50);
    }
    
    entries.push({
      user_id: userId,
      occurred_at: entryDate.toISOString(),
      mileage_km: currentMileage,
      note: i === 0 ? 'Начальная запись' : null,
    });
  }

  const { data: insertedEntries, error: entriesError } = await supabase
    .from('odometer_entries')
    .insert(entries)
    .select();

  if (entriesError) {
    throw new Error(`Failed to insert odometer entries: ${entriesError.message}`);
  }

  if (!insertedEntries || insertedEntries.length === 0) {
    throw new Error('Failed to insert odometer entries: No data returned');
  }

  // Get all odometer entries sorted by mileage for date interpolation
  const { data: allOdometerEntries, error: entriesFetchError } = await supabase
    .from('odometer_entries')
    .select('*')
    .eq('user_id', userId)
    .order('mileage_km', { ascending: true })
    .order('occurred_at', { ascending: true });

  if (entriesFetchError || !allOdometerEntries || allOdometerEntries.length === 0) {
    throw new Error(`Failed to fetch odometer entries: ${entriesFetchError?.message || 'No data'}`);
  }

  const maxMileage = allOdometerEntries[allOdometerEntries.length - 1].mileage_km;
  const maxDate = new Date(allOdometerEntries[allOdometerEntries.length - 1].occurred_at);

  // Insert initial service events for each item (baseline replacements)
  // Each item gets one service_event representing the last replacement
  const serviceEvents: Array<{
    user_id: string;
    service_item_id: string;
    occurred_at: string;
    mileage_km: number;
    note: string | null;
  }> = [];

  for (const item of insertedItems) {
    let lastMileage: number;
    let lastDate: Date;

    // Determine lastMileage based on interval_km
    if (item.interval_km) {
      // Set lastReplacementMileage so that remainingKm is between 0.6*interval and 1.1*interval
      // This ensures some items are soon/overdue and some are OK
      const remainingKmMin = Math.round(item.interval_km * 0.6);
      const remainingKmMax = Math.round(item.interval_km * 1.1);
      const remainingKmTarget = remainingKmMin + Math.random() * (remainingKmMax - remainingKmMin);
      
      lastMileage = maxMileage - remainingKmTarget;
      
      // Clamp to valid range: at least (maxMileage - 50000) and <= maxMileage
      lastMileage = Math.max(maxMileage - 50000, Math.min(lastMileage, maxMileage));
    } else {
      // Items with only interval_days: set lastMileage to a reasonable past value
      const mileageDiff = 2000 + Math.random() * 15000; // 2000-17000 km ago
      lastMileage = Math.max(0, maxMileage - Math.round(mileageDiff));
    }

    // Ensure lastMileage <= maxMileage (satisfy DB guardrail)
    lastMileage = Math.min(Math.round(lastMileage), maxMileage);

    // Determine lastDate based on interval_days or interpolate from mileage
    if (item.interval_days && !item.interval_km) {
      // Items with only interval_days: set date based on interval
      const progress = 0.6 + Math.random() * 0.5; // 60-110% through interval
      const daysAgo = Math.round(item.interval_days * progress);
      lastDate = new Date(maxDate);
      lastDate.setDate(lastDate.getDate() - daysAgo);
    } else {
      // Items with interval_km: interpolate date from mileage using odometer history
      lastDate = findDateForMileage(allOdometerEntries, lastMileage);
    }

    // Ensure date is not in the future
    if (lastDate > maxDate) {
      lastDate = new Date(maxDate);
      lastDate.setDate(lastDate.getDate() - 1); // At least 1 day before max
    }

    serviceEvents.push({
      user_id: userId,
      service_item_id: item.id,
      occurred_at: lastDate.toISOString(),
      mileage_km: lastMileage,
      note: 'Демо: последняя замена',
    });
  }

  const { data: insertedEvents, error: eventsError } = await supabase
    .from('service_events')
    .insert(serviceEvents)
    .select();

  if (eventsError) {
    throw new Error(`Failed to insert service events: ${eventsError.message}`);
  }

  const result = {
    serviceItems: insertedItems.length,
    odometerEntries: insertedEntries.length,
    serviceEvents: insertedEvents?.length || 0,
  };

  // Invalidate all cache tags after seeding data
  revalidateTag(TAGS.odometer, 'max');
  revalidateTag(TAGS.odometerEntries, 'max');
  revalidateTag(TAGS.serviceItems, 'max');
  revalidateTag(TAGS.serviceEvents, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');

  return result;
}

/**
 * Simulate a trip by adding a new odometer entry
 * @returns The inserted odometer entry
 * @throws Error if no odometer entries exist
 */
export async function simulateTrip(): Promise<OdometerEntry> {
  const result = await simulateTripRange('day');
  return result.entry;
}

export interface SimulateTripResult {
  entry: OdometerEntry;
  dayIncrement: number;
  totalIncrementKm: number;
  newAppNowIso?: string; // ISO string of the last inserted entry's occurred_at (for AppNow advancement in TEST mode)
}

/**
 * Simulate a trip over a specified time range
 * @param range Time range: 'day', 'week', or 'month'
 * @param baseNowIso Optional ISO string of AppNow to use as base date (for TEST mode). If not provided, uses the date of the previous entry (backward compatible).
 * @returns The inserted odometer entry with simulation details
 * @throws Error if no odometer entries exist
 */
export async function simulateTripRange(
  range: 'day' | 'week' | 'month',
  baseNowIso?: string
): Promise<SimulateTripResult> {
  const { supabase, userId } = await getRlsClientAndUserId();

  // Get entry with maximum mileage_km (to satisfy monotonic constraints)
  // Order by mileage_km desc first, then occurred_at desc as tie-breaker
  const { data: maxMileageEntry, error: fetchError } = await supabase
    .from('odometer_entries')
    .select('*')
    .eq('user_id', userId)
    .order('mileage_km', { ascending: false })
    .order('occurred_at', { ascending: false })
    .limit(1)
    .single();

  if (fetchError || !maxMileageEntry) {
    throw new Error('Сначала добавьте пробег');
  }

  const baseEntry = maxMileageEntry;
  const baseMileage = baseEntry.mileage_km;
  
  // Use baseNowIso if provided (TEST mode with AppNow), otherwise use previous entry's date (backward compatible)
  let baseDate: Date;
  if (baseNowIso) {
    baseDate = new Date(baseNowIso);
    // Validate baseNowIso
    if (isNaN(baseDate.getTime())) {
      throw new Error(`Invalid baseNowIso: ${baseNowIso}`);
    }
  } else {
    // Backward compatible: use previous entry's date
    baseDate = new Date(baseEntry.occurred_at);
  }

  // Determine total increment and day increment based on range
  let totalIncrementKm: number;
  let dayIncrement: number;
  let notePrefix: string;
  
  switch (range) {
    case 'day':
      // Поездил день: 60-150 км
      totalIncrementKm = Math.round(60 + Math.random() * 90); // 60-150 km
      dayIncrement = 1;
      notePrefix = 'DEV: simulate day';
      break;
    case 'week':
      // Поездил неделю: 420-680 км
      totalIncrementKm = Math.round(420 + Math.random() * 260); // 420-680 km
      dayIncrement = 7;
      notePrefix = 'DEV: simulate week';
      break;
    case 'month':
      // Поездил месяц: 2000-3000 км
      totalIncrementKm = Math.round(2000 + Math.random() * 1000); // 2000-3000 km
      dayIncrement = 30;
      notePrefix = 'DEV: simulate month';
      break;
  }

  const nextMileage = baseMileage + totalIncrementKm;

  // Calculate next date (use baseDate as baseline, even if it's in the future)
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + dayIncrement);

  // Insert new entry
  const { data: inserted, error: insertError } = await supabase
    .from('odometer_entries')
    .insert({
      user_id: userId,
      occurred_at: nextDate.toISOString(),
      mileage_km: nextMileage,
      note: notePrefix,
    })
    .select()
    .single();

  if (insertError) {
    // Log detailed context for debugging (not shown to user)
    console.error('Dev simulation failed:', {
      baseMileage,
      baseDate: baseDate.toISOString(),
      attemptedMileage: nextMileage,
      attemptedDate: nextDate.toISOString(),
      dayIncrement,
      totalIncrementKm,
      error: insertError.message,
    });
    throw new Error(`Failed to insert trip: ${insertError.message}`);
  }

  if (!inserted) {
    throw new Error('Failed to insert trip: No data returned');
  }

  // CRITICAL: Invalidate cache after inserting new entry
  // Use both revalidateTag and revalidatePath to ensure cache is cleared
  
  // Invalidate all relevant tags
  revalidateTag(TAGS.odometer, 'max');
  revalidateTag(TAGS.odometerEntries, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  
  // Revalidate paths with all types to ensure complete cache invalidation
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  // Also revalidate with 'page' type explicitly for the home route
  revalidatePath('/');
  const { data: verifyEntry, error: verifyError } = await supabase
    .from('odometer_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('id', inserted.id)
    .single();

  // Also verify by reading latest entry directly from DB (bypassing cache)
  const { data: latestDirect, error: latestError } = await supabase
    .from('odometer_entries')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .order('mileage_km', { ascending: false })
    .limit(1)
    .single();

  return {
    entry: inserted,
    dayIncrement,
    totalIncrementKm,
    newAppNowIso: inserted.occurred_at, // Return the occurred_at of the inserted entry for AppNow advancement
  };
}

/**
 * Reset and seed demo data in one operation
 * Wipes all data and seeds fresh demo data
 * Uses mutex to prevent race conditions
 * @returns Summary of inserted records
 * @throws Error if operation is already in progress
 */
export async function resetAndSeedDemoData(): Promise<SeedResult> {
  // Check mutex
  if (isResetting) {
    throw new Error('Демо-операция уже выполняется');
  }

  try {
    isResetting = true;
    
    // Wipe all data first
    await wipeAllData();
    
    // Then seed fresh data (skip existence check since we just wiped)
    const result = await seedDemoData(true);
    
    return result;
  } finally {
    isResetting = false;
  }
}

/**
 * Wipe all MileKeeper data
 * Deletes in order: service_events, service_items, odometer_entries
 */
export async function wipeAllData(): Promise<{ success: boolean }> {
  const { supabase, userId } = await getRlsClientAndUserId();

  // Delete in order to respect foreign key constraints
  // Use a condition that matches all rows (id is not null, which is always true for UUIDs)
  const { error: eventsError } = await supabase
    .from('service_events')
    .delete()
    .eq('user_id', userId);

  if (eventsError) {
    throw new Error(`Failed to delete service events: ${eventsError.message}`);
  }

  const { error: itemsError } = await supabase
    .from('service_items')
    .delete()
    .eq('user_id', userId);

  if (itemsError) {
    throw new Error(`Failed to delete service items: ${itemsError.message}`);
  }

  const { error: entriesError } = await supabase
    .from('odometer_entries')
    .delete()
    .eq('user_id', userId);

  if (entriesError) {
    throw new Error(`Failed to delete odometer entries: ${entriesError.message}`);
  }

  // Invalidate all cache tags after wiping data
  revalidateTag(TAGS.odometer, 'max');
  revalidateTag(TAGS.odometerEntries, 'max');
  revalidateTag(TAGS.serviceItems, 'max');
  revalidateTag(TAGS.serviceEvents, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');

  return { success: true };
}

