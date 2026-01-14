/**
 * Helper functions for forecasting days based on odometer entries
 * Used to predict when km-based service items will be due
 */

import type { OdometerEntry } from '../db/types';
import { calculateDailyMileageRateToBe } from './dailyMileageRateToBe';

export interface EstimateOptions {
  maxDays?: number; // Default: 14
  maxEntries?: number; // Default: 20
  minDailyKm?: number; // Default: 1
  maxDailyKm?: number; // Default: 1500
  fallbackDailyKm?: number; // Default: 30 (used when insufficient data)
  anchorNow?: Date; // Optional: anchor date for window calculation (defaults to newestEntry.occurred_at)
}

export interface EstimateResult {
  // TO-BE: may be null when insufficient data
  dailyKmRate: number | null;
  // TO-BE fallback refers to the "14 active days" fallback (not numeric-rate fallback)
  isFallback: boolean;
  // TO-BE: primary window is rolling 60 days; fallback window label is not claimed
  windowDaysUsed?: number | null; // 60, or null when fallback/insufficient
  // Not used by TO-BE MVP (kept for UI diagnostics compatibility)
  samplesUsed?: number;
  fallbackReason?: string | null;
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
  const r = calculateDailyMileageRateToBe(entries, anchorNow);
  return {
    dailyKmRate: r.dailyRate,
    isFallback: r.isFallback,
    windowDaysUsed: r.dailyRate !== null && !r.isFallback ? 60 : null,
    samplesUsed: undefined,
    fallbackReason: r.reason ?? null,
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
  // TO-BE: legacy API is now a thin wrapper over TO-BE calculation.
  // TO-BE requires a single canonical `now`. Call sites must pass it via opts.anchorNow.
  // (The application-level call sites use getAppNow() and pass it explicitly.)
  const anchor = opts.anchorNow;
  if (!anchor) {
    return {
      dailyKmRate: null,
      isFallback: false,
      windowDaysUsed: null,
      samplesUsed: undefined,
      fallbackReason: 'insufficient_data (missing anchorNow)',
    };
  }
  const r = calculateDailyMileageRateToBe(entries, anchor);
  return {
    dailyKmRate: r.dailyRate,
    isFallback: r.isFallback,
    windowDaysUsed: r.dailyRate !== null && !r.isFallback ? 60 : null,
    samplesUsed: undefined,
    fallbackReason: r.reason ?? null,
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
  return result.dailyKmRate;
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

