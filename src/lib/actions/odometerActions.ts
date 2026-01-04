'use server';

/**
 * Server-side actions for odometer entries
 * Uses admin client - server-only, never import in client components
 */

import { unstable_cache } from 'next/cache';
import { revalidateTag, revalidatePath } from 'next/cache';
import { createAdminClient } from '../supabase/adminClient';
import { TAGS } from '../cache/tags';
import type { OdometerEntry, OdometerEntryInput } from '../db/types';

/**
 * List odometer entries, ordered by occurred_at descending
 * @param limit Optional limit on number of entries to return
 * @returns Array of odometer entries
 */
async function _listOdometerEntries(limit?: number): Promise<OdometerEntry[]> {
  const supabase = createAdminClient();
  
  let query = supabase
    .from('odometer_entries')
    .select('*')
    .order('occurred_at', { ascending: false });
  
  if (limit !== undefined) {
    query = query.limit(limit);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw new Error(`Failed to list odometer entries: ${error.message}`);
  }
  
  return data || [];
}

export async function listOdometerEntries(limit?: number): Promise<OdometerEntry[]> {
  const cacheKey = limit !== undefined ? `odometerEntries:${limit}` : 'odometerEntries:all';
  const result = await unstable_cache(
    () => _listOdometerEntries(limit),
    [cacheKey],
    {
      tags: [TAGS.odometerEntries],
    }
  )();
  return result;
}

/**
 * Get the latest odometer entry by occurred_at (desc), with mileage_km as tie-breaker
 * @returns Latest odometer entry or null if none exist
 */
async function _getLatestOdometerEntry(): Promise<OdometerEntry | null> {
  const supabase = createAdminClient();
  
  // First try by occurred_at desc, then mileage_km desc as tie-breaker
  const { data, error } = await supabase
    .from('odometer_entries')
    .select('*')
    .order('occurred_at', { ascending: false })
    .order('mileage_km', { ascending: false })
    .limit(1)
    .single();
  
  if (error) {
    // If no rows found, return null (not an error)
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get latest odometer entry: ${error.message}`);
  }
  
  return data;
}

const _getLatestOdometerEntryCached = unstable_cache(
  _getLatestOdometerEntry,
  ['odometer'],
  {
    tags: [TAGS.odometer],
  }
);

export async function getLatestOdometerEntry(): Promise<OdometerEntry | null> {
  // In dev mode, bypass cache to ensure fresh data
  if (process.env.NODE_ENV !== 'production') {
    return await _getLatestOdometerEntry();
  }
  
  return await _getLatestOdometerEntryCached();
}

/**
 * Get the odometer entry with the maximum mileage
 * This represents the "current mileage" of the vehicle
 * @returns Entry with maximum mileage or null if none exist
 */
async function _getMaxMileageEntry(): Promise<OdometerEntry | null> {
  const supabase = createAdminClient();
  
  const { data, error } = await supabase
    .from('odometer_entries')
    .select('*')
    .order('mileage_km', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get max mileage entry: ${error.message}`);
  }
  
  return data;
}

const _getMaxMileageEntryCached = unstable_cache(
  _getMaxMileageEntry,
  ['odometer-max'],
  {
    tags: [TAGS.odometer],
  }
);

export async function getMaxMileageEntry(): Promise<OdometerEntry | null> {
  // In dev mode, bypass cache to ensure fresh data
  if (process.env.NODE_ENV !== 'production') {
    return await _getMaxMileageEntry();
  }
  
  return await _getMaxMileageEntryCached();
}

/**
 * Add a new odometer entry with strict mileage validation
 * @param input Odometer entry data
 * @returns The inserted odometer entry
 * @throws Error if mileage is not strictly greater than the latest entry
 */
export async function addOdometerEntry(
  input: OdometerEntryInput
): Promise<OdometerEntry> {
  const supabase = createAdminClient();

  // Fetch the maximum mileage from database to validate monotonicity
  // This matches what the database trigger uses (MAX(mileage_km))
  // Note: getLatestOdometerEntry() returns entry by date, not by max mileage
  const { data: maxMileageData, error: maxMileageError } = await supabase
    .from('odometer_entries')
    .select('mileage_km')
    .order('mileage_km', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (maxMileageError && maxMileageError.code !== 'PGRST116') {
    throw new Error(`Failed to fetch max mileage: ${maxMileageError.message}`);
  }
  
  const maxMileage = maxMileageData?.mileage_km ?? null;

  if (maxMileage !== null && input.mileageKm <= maxMileage) {
    throw new Error(
      `Mileage must be greater than previous entry. ` +
      `Latest mileage: ${maxMileage} km, provided: ${input.mileageKm} km`
    );
  }
  
  // Insert the new entry
  const { data, error } = await supabase
    .from('odometer_entries')
    .insert({
      occurred_at: input.occurredAt.toISOString(),
      mileage_km: input.mileageKm,
      note: input.note || null,
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to add odometer entry: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('Failed to add odometer entry: No data returned');
  }
  
  // Invalidate cache tags after successful write
  revalidateTag(TAGS.odometer, 'max');
  revalidateTag(TAGS.odometerEntries, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  
  // Also revalidate the home page path to ensure immediate UI update
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  
  return data;
}

/**
 * Delete the latest odometer entry (safest deletion - only the most recent)
 * @returns The ID of the deleted entry
 * @throws Error if no entries exist or deletion fails
 */
export async function deleteLatestOdometerEntry(): Promise<string> {
  const supabase = createAdminClient();
  
  // Fetch the latest entry
  const latest = await getLatestOdometerEntry();
  
  if (latest === null) {
    throw new Error('Нет записей для удаления');
  }
  
  // Delete the latest entry by id
  const { error } = await supabase
    .from('odometer_entries')
    .delete()
    .eq('id', latest.id);
  
  if (error) {
    throw new Error(`Failed to delete odometer entry: ${error.message}`);
  }
  
  // Invalidate cache tags after successful deletion
  revalidateTag(TAGS.odometer, 'max');
  revalidateTag(TAGS.odometerEntries, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  
  return latest.id;
}

/**
 * Update the latest odometer entry with strict mileage validation
 * Validates against the second latest entry to maintain monotonicity
 * @param input Updated odometer entry data
 * @returns The updated odometer entry
 * @throws Error if no entries exist, mileage is invalid, or update fails
 */
export async function updateLatestOdometerEntry(
  input: { mileageKm: number; occurredAt: Date; note?: string | null }
): Promise<OdometerEntry> {
  const supabase = createAdminClient();
  
  // Fetch the latest entry
  const latest = await getLatestOdometerEntry();
  
  if (latest === null) {
    throw new Error('Нет записей для редактирования');
  }
  
  // Fetch the second latest entry for validation
  // Get top 2 entries ordered by occurred_at desc, then mileage_km desc
  const { data: topEntries, error: fetchError } = await supabase
    .from('odometer_entries')
    .select('*')
    .order('occurred_at', { ascending: false })
    .order('mileage_km', { ascending: false })
    .limit(2);
  
  if (fetchError) {
    throw new Error(`Failed to fetch entries: ${fetchError.message}`);
  }
  
  // The first entry is the latest, the second (if exists) is the previous one
  const previousEntry = topEntries && topEntries.length > 1 ? topEntries[1] : null;
  
  // Validate mileage monotonicity
  if (previousEntry !== null && input.mileageKm <= previousEntry.mileage_km) {
    throw new Error(
      `Пробег должен быть больше предыдущей записи. ` +
      `Предыдущая запись: ${previousEntry.mileage_km} km, указано: ${input.mileageKm} km`
    );
  }
  
  if (input.mileageKm <= 0) {
    throw new Error('Пробег должен быть положительным числом');
  }
  
  // Update the latest entry
  const { data, error } = await supabase
    .from('odometer_entries')
    .update({
      mileage_km: input.mileageKm,
      occurred_at: input.occurredAt.toISOString(),
      note: input.note || null,
    })
    .eq('id', latest.id)
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to update odometer entry: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('Failed to update odometer entry: No data returned');
  }
  
  // Invalidate cache tags after successful update
  revalidateTag(TAGS.odometer, 'max');
  revalidateTag(TAGS.odometerEntries, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  
  return data;
}

