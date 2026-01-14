'use server';

/**
 * Server-side actions for odometer entries
 * Uses user-scoped client (RLS)
 */

import { revalidateTag, revalidatePath } from 'next/cache';
import { getRlsClientAndUserId } from '../supabase/rlsServerClient';
import { TAGS } from '../cache/tags';
import type { OdometerEntry, OdometerEntryInput } from '../db/types';
import { logMileageQuery } from '../dev/mileageDiagnostics';

/**
 * List odometer entries, ordered by occurred_at descending
 * @param limit Optional limit on number of entries to return
 * @returns Array of odometer entries
 */
async function _listOdometerEntries(limit?: number): Promise<OdometerEntry[]> {
  const { supabase, userId } = await getRlsClientAndUserId();
  
  let query = supabase
    .from('odometer_entries')
    .select('*')
    .eq('user_id', userId)
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
  // IMPORTANT: This function fetches via RLS client (cookies) and must NOT be wrapped in unstable_cache.
  return await _listOdometerEntries(limit);
}

/**
 * Get the latest odometer entry by occurred_at (desc), with mileage_km as tie-breaker
 * @returns Latest odometer entry or null if none exist
 */
async function _getLatestOdometerEntry(): Promise<OdometerEntry | null> {
  const { supabase, userId } = await getRlsClientAndUserId();
  
  // First try by occurred_at desc, then mileage_km desc as tie-breaker
  const { data, error } = await supabase
    .from('odometer_entries')
    .select('*')
    .eq('user_id', userId)
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

export async function getLatestOdometerEntry(screenName?: string): Promise<OdometerEntry | null> {
  // IMPORTANT: This function fetches via RLS client (cookies) and must NOT be wrapped in unstable_cache.
  const result = await _getLatestOdometerEntry();
  
  // Diagnostic logging (only in dev/preview or when NEXT_PUBLIC_DIAGNOSTICS=1)
  if (screenName) {
    logMileageQuery({
      screenName,
      queryName: 'getLatestOdometerEntry',
      sortKey: 'occurred_at DESC, mileage_km DESC',
      returnedRecord: result ? {
        id: result.id,
        mileage_km: result.mileage_km,
        occurred_at: result.occurred_at,
        timestamp: result.occurred_at,
      } : null,
    });
  }
  
  return result;
}

/**
 * Get the odometer entry with the maximum mileage
 * This represents the "current mileage" of the vehicle
 * @returns Entry with maximum mileage or null if none exist
 */
async function _getMaxMileageEntry(): Promise<OdometerEntry | null> {
  const { supabase, userId } = await getRlsClientAndUserId();
  
  const { data, error } = await supabase
    .from('odometer_entries')
    .select('*')
    .eq('user_id', userId)
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

export async function getMaxMileageEntry(screenName?: string): Promise<OdometerEntry | null> {
  // Always bypass cache to ensure fresh data
  // This is critical for accurate current mileage display across all pages
  // The performance impact is minimal as this is a simple query with LIMIT 1
  const result = await _getMaxMileageEntry();
  
  // Diagnostic logging (only in dev/preview or when NEXT_PUBLIC_DIAGNOSTICS=1)
  if (screenName) {
    logMileageQuery({
      screenName,
      queryName: 'getMaxMileageEntry',
      sortKey: 'mileage_km DESC',
      returnedRecord: result ? {
        id: result.id,
        mileage_km: result.mileage_km,
        occurred_at: result.occurred_at,
        timestamp: result.occurred_at,
      } : null,
    });
  }
  
  return result;
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
  const { supabase, userId } = await getRlsClientAndUserId();
  
  // Fetch the maximum mileage from database to validate monotonicity
  // This matches what the database trigger uses (MAX(mileage_km))
  // Note: getLatestOdometerEntry() returns entry by date, not by max mileage
  const { data: maxMileageData, error: maxMileageError } = await supabase
    .from('odometer_entries')
    .select('mileage_km')
    .eq('user_id', userId)
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
      user_id: userId,
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
  
  // Also revalidate paths to ensure immediate UI update
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  revalidatePath('/items', 'page');
  revalidatePath('/items', 'layout'); // This invalidates all /items/* dynamic routes
  
  return data;
}

/**
 * Delete the latest odometer entry (safest deletion - only the most recent)
 * @returns The ID of the deleted entry
 * @throws Error if no entries exist or deletion fails
 */
export async function deleteLatestOdometerEntry(): Promise<string> {
  const { supabase, userId } = await getRlsClientAndUserId();
  
  // Fetch the latest entry
  const latest = await getLatestOdometerEntry('DeleteLatestOdometerEntry');
  
  if (latest === null) {
    throw new Error('Нет записей для удаления');
  }
  
  // Delete the latest entry by id
  const { error } = await supabase
    .from('odometer_entries')
    .delete()
    .eq('id', latest.id)
    .eq('user_id', userId);
  
  if (error) {
    throw new Error(`Failed to delete odometer entry: ${error.message}`);
  }
  
  // Invalidate cache tags after successful deletion
  revalidateTag(TAGS.odometer, 'max');
  revalidateTag(TAGS.odometerEntries, 'max');
  revalidateTag(TAGS.home, 'max');
  revalidateTag(TAGS.items, 'max');
  
  // Also revalidate paths to ensure immediate UI update
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  revalidatePath('/items', 'page');
  revalidatePath('/items', 'layout');
  
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
  const { supabase, userId } = await getRlsClientAndUserId();
  
  // Fetch the latest entry
  const latest = await getLatestOdometerEntry('UpdateLatestOdometerEntry');
  
  if (latest === null) {
    throw new Error('Нет записей для редактирования');
  }
  
  // Fetch the second latest entry for validation
  // Get top 2 entries ordered by occurred_at desc, then mileage_km desc
  const { data: topEntries, error: fetchError } = await supabase
    .from('odometer_entries')
    .select('*')
    .eq('user_id', userId)
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
    .eq('user_id', userId)
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
  
  // Also revalidate paths to ensure immediate UI update
  revalidatePath('/', 'page');
  revalidatePath('/', 'layout');
  revalidatePath('/items', 'page');
  revalidatePath('/items', 'layout');
  
  return data;
}

