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
}

export interface EstimateResult {
  dailyKmRate: number; // Always > 0 (never null)
  isFallback: boolean; // True if fallback was used
}

/**
 * Estimate average daily km rate from odometer entries
 * Uses a sliding window: last 14 days OR last 20 entries (whichever is smaller)
 * @param entries Odometer entries ordered by occurred_at descending (newest first)
 * @param opts Optional configuration
 * @returns EstimateResult with dailyKmRate (always > 0) and isFallback flag
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
  const newestDate = new Date(newestEntry.occurred_at);

  // Calculate cutoff date
  const cutoffDate = new Date(newestDate);
  cutoffDate.setDate(cutoffDate.getDate() - maxDays);

  // Filter entries within the time window and limit count
  const windowEntries = entries
    .filter((entry) => new Date(entry.occurred_at) >= cutoffDate)
    .slice(0, maxEntries)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()); // Sort ascending for calculation

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

  return { dailyKmRate, isFallback: false };
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

