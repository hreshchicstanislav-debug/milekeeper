/**
 * Helper functions for forecasting days based on odometer entries
 * Used to predict when km-based service items will be due
 */

import type { OdometerEntry } from '../db/types';

export interface EstimateOptions {
  maxDays?: number; // Default: 14
  maxEntries?: number; // Default: 20
  minDailyKm?: number; // Default: 1
  maxDailyKm?: number; // Default: 1500
  fallbackDailyKm?: number; // Default: 30 (used when insufficient data)
  anchorNow?: Date; // Optional: anchor date for window calculation (defaults to newestEntry.occurred_at)
}

export interface EstimateResult {
  dailyKmRate: number; // Always > 0 (never null)
  isFallback: boolean; // True if fallback was used
  windowDaysUsed?: number | null; // 14, 60, or null if fallback
  samplesUsed?: number; // Number of entries used in calculation
  fallbackReason?: string | null; // Reason for fallback, if applicable
}

/**
 * Unified daily mileage rate calculation with 14/60-day window selection
 * Always anchored to AppNow, excludes future entries, tries 14-day window first, then 60-day, then fallback
 * @param entries Odometer entries ordered by occurred_at descending (newest first)
 * @param anchorNow Required: anchor date (AppNow) for window calculation
 * @returns EstimateResult with dailyKmRate, windowDaysUsed, samplesUsed, and fallbackReason
 */
export function estimateDailyKmRateUnified(
  entries: OdometerEntry[],
  anchorNow: Date
): EstimateResult {
  const minDailyKm = 1;
  const maxDailyKm = 1500;
  const fallbackDailyKm = 30; // Default fallback: 30 km/day
  const safeFallback = Math.max(minDailyKm, Math.min(maxDailyKm, fallbackDailyKm));

  if (entries.length < 2) {
    return {
      dailyKmRate: safeFallback,
      isFallback: true,
      windowDaysUsed: null,
      samplesUsed: entries.length,
      fallbackReason: 'entries.length < 2',
    };
  }

  // Helper function to try a window
  const tryWindow = (windowDays: number, maxEntries: number): EstimateResult | null => {
    const cutoff = new Date(anchorNow.getTime() - windowDays * 24 * 60 * 60 * 1000);
    
    // Filter entries: only those within [cutoff, anchorNow] (exclude future entries)
    const filteredEntries = entries.filter((entry) => {
      const entryDate = new Date(entry.occurred_at);
      return entryDate >= cutoff && entryDate <= anchorNow;
    });

    if (filteredEntries.length < 2) {
      return null; // Not enough entries
    }

    // Apply maxEntries limit and sort ascending for calculation
    const windowEntries = filteredEntries
      .slice(0, maxEntries)
      .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

    if (windowEntries.length < 2) {
      return null; // Not enough entries after limiting
    }

    // Calculate total delta
    const oldest = windowEntries[0];
    const newest = windowEntries[windowEntries.length - 1];
    
    const deltaDays = (new Date(newest.occurred_at).getTime() - new Date(oldest.occurred_at).getTime()) / (1000 * 60 * 60 * 24);
    const deltaKm = newest.mileage_km - oldest.mileage_km;

    // Validate delta
    if (deltaDays < 1 || deltaKm <= 0) {
      return null; // Invalid delta
    }

    // Calculate daily rate
    const dailyKmRate = deltaKm / deltaDays;

    // Clamp to reasonable bounds
    if (dailyKmRate < minDailyKm || dailyKmRate > maxDailyKm) {
      return null; // Out of bounds
    }

    // Success
    return {
      dailyKmRate,
      isFallback: false,
      windowDaysUsed: windowDays,
      samplesUsed: windowEntries.length,
      fallbackReason: null,
    };
  };

  // Try 14-day window first (max 20 entries)
  const result14 = tryWindow(14, 20);
  if (result14) {
    return result14;
  }

  // Try 60-day window (max 60 entries)
  const result60 = tryWindow(60, 60);
  if (result60) {
    return result60;
  }

  // Fallback: insufficient data
  return {
    dailyKmRate: safeFallback,
    isFallback: true,
    windowDaysUsed: null,
    samplesUsed: entries.length,
    fallbackReason: 'insufficient data in both 14-day and 60-day windows',
  };
}

/**
 * Estimate average daily km rate from odometer entries
 * Uses a sliding window: last 14 days OR last 20 entries (whichever is smaller)
 * @param entries Odometer entries ordered by occurred_at descending (newest first)
 * @param opts Optional configuration
 * @returns EstimateResult with dailyKmRate (always > 0) and isFallback flag
 * @deprecated Use estimateDailyKmRateUnified() for new code. This function is kept for backward compatibility.
 */
export function estimateDailyKmRate(
  entries: OdometerEntry[],
  opts: EstimateOptions = {}
): EstimateResult {
  const {
    maxDays = 14,
    maxEntries = 20,
    minDailyKm = 1,
    maxDailyKm = 1500,
    fallbackDailyKm = 30, // Default fallback: 30 km/day
  } = opts;

  // Ensure fallback is within bounds
  const safeFallback = Math.max(minDailyKm, Math.min(maxDailyKm, fallbackDailyKm));

  if (entries.length < 2) {
    return { dailyKmRate: safeFallback, isFallback: true };
  }

  // Get the most recent entry (first in descending order)
  const newestEntry = entries[0];
  
  // Use anchorNow if provided (for AppNow-based window anchoring), otherwise use newestEntry date
  const anchor = opts.anchorNow ?? new Date(newestEntry.occurred_at);
  
  // Calculate cutoff date relative to anchor date (using millisecond precision)
  const cutoff = new Date(anchor.getTime() - maxDays * 24 * 60 * 60 * 1000);

  // Filter entries within the time window
  // If anchorNow is provided: only include entries <= anchorNow AND >= cutoff (exclude future entries)
  // If anchorNow is not provided: only include entries >= cutoff (backward compatible)
  let filteredEntries = entries;
  if (opts.anchorNow) {
    // When anchorNow is provided, exclude entries after anchorNow
    filteredEntries = entries.filter((entry) => {
      const entryDate = new Date(entry.occurred_at);
      return entryDate >= cutoff && entryDate <= anchor;
    });
  } else {
    // Backward compatible: when anchorNow is not provided, use existing behavior
    filteredEntries = entries.filter((entry) => new Date(entry.occurred_at) >= cutoff);
  }

  // Apply maxEntries limit and sort ascending for calculation
  const windowEntries = filteredEntries
    .slice(0, maxEntries)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  if (windowEntries.length < 2) {
    return { dailyKmRate: safeFallback, isFallback: true };
  }

  // Calculate total delta
  const oldest = windowEntries[0];
  const newest = windowEntries[windowEntries.length - 1];
  
  const deltaDays = (new Date(newest.occurred_at).getTime() - new Date(oldest.occurred_at).getTime()) / (1000 * 60 * 60 * 24);
  const deltaKm = newest.mileage_km - oldest.mileage_km;

  // Validate delta
  if (deltaDays < 1 || deltaKm <= 0) {
    return { dailyKmRate: safeFallback, isFallback: true };
  }

  // Calculate daily rate
  const dailyKmRate = deltaKm / deltaDays;

  // Clamp to reasonable bounds
  if (dailyKmRate < minDailyKm || dailyKmRate > maxDailyKm) {
    return { dailyKmRate: safeFallback, isFallback: true };
  }

  return { 
    dailyKmRate, 
    isFallback: false,
    windowDaysUsed: maxDays,
    samplesUsed: windowEntries.length,
    fallbackReason: null,
  };
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use estimateDailyKmRate() which returns EstimateResult
 */
export function estimateDailyKmRateLegacy(
  entries: OdometerEntry[],
  opts: EstimateOptions = {}
): number | null {
  const result = estimateDailyKmRate(entries, opts);
  // Return null only if we really can't estimate (shouldn't happen with fallback)
  return result.isFallback ? null : result.dailyKmRate;
}

/**
 * Estimate days to reach a target remaining km
 * @param remainingKm Remaining kilometers until due
 * @param dailyKmRate Average km/day rate (from estimateDailyKmRate, always > 0)
 * @returns Estimated days (always a number, never null)
 */
export function estimateDaysToReachKm(
  remainingKm: number | null,
  dailyKmRate: number
): number {
  if (remainingKm === null || remainingKm <= 0) {
    return 0;
  }

  if (dailyKmRate <= 0) {
    // Shouldn't happen, but fallback to safe value
    return Math.ceil(remainingKm / 30);
  }

  const days = remainingKm / dailyKmRate;
  
  // Normalize near-zero values
  if (Math.abs(days) < 0.01) {
    return 0;
  }

  return Math.ceil(days); // Round up to whole days
}

