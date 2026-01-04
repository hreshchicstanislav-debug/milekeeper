/**
 * Helper functions for computing daily rate (km/day) from odometer entries
 * Used for predicting when service items will be due based on km intervals
 */

import type { OdometerEntry } from '../db/types';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Compute median km/day from recent odometer entries
 * Uses last 10 entries within 60 days
 * @param entries Odometer entries ordered by occurred_at descending
 * @returns Median km/day or null if insufficient data
 */
export function computeDailyRate(entries: OdometerEntry[]): number | null {
  if (entries.length < 2) {
    return null;
  }

  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Filter entries within last 60 days, take most recent 10, then sort ascending for calculation
  const recentEntries = entries
    .filter((entry) => new Date(entry.occurred_at) >= sixtyDaysAgo)
    .slice(0, 10) // Take most recent 10 (entries are already sorted descending)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()); // Sort ascending for calculation

  if (recentEntries.length < 2) {
    return null;
  }

  // Compute km/day for each consecutive pair
  const rates: number[] = [];
  for (let i = 1; i < recentEntries.length; i++) {
    const prev = recentEntries[i - 1];
    const curr = recentEntries[i];
    const daysDiff =
      (new Date(curr.occurred_at).getTime() - new Date(prev.occurred_at).getTime()) /
      (1000 * 60 * 60 * 24);
    
    if (daysDiff > 0) {
      const kmDiff = curr.mileage_km - prev.mileage_km;
      if (kmDiff > 0) {
        rates.push(kmDiff / daysDiff);
      }
    }
  }

  if (rates.length === 0) {
    return null;
  }

  // Return median
  rates.sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 === 0
    ? (rates[mid - 1] + rates[mid]) / 2
    : rates[mid];
}

/**
 * Get days since the last odometer entry
 * @param entries Odometer entries ordered by occurred_at descending
 * @returns Number of days since last entry, or null if no entries
 */
export function getDaysSinceLastEntry(entries: OdometerEntry[]): number | null {
  if (entries.length === 0) {
    return null;
  }

  const lastEntry = entries[0]; // First entry is most recent (descending order)
  const lastEntryDate = new Date(lastEntry.occurred_at);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - lastEntryDate.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff;
}

/**
 * Compute prediction confidence based on odometer entry history
 * @param entries Odometer entries ordered by occurred_at descending
 * @returns Confidence level: 'high', 'medium', or 'low'
 */
export function computeConfidence(entries: OdometerEntry[]): ConfidenceLevel {
  if (entries.length === 0) {
    return 'low';
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Count entries in last 30 and 60 days
  const entriesLast30Days = entries.filter(
    (entry) => new Date(entry.occurred_at) >= thirtyDaysAgo
  ).length;
  const entriesLast60Days = entries.filter(
    (entry) => new Date(entry.occurred_at) >= sixtyDaysAgo
  ).length;

  const daysSinceLast = getDaysSinceLastEntry(entries);

  // High confidence: at least 6 entries in last 30 days AND last entry within 3 days
  if (entriesLast30Days >= 6 && daysSinceLast !== null && daysSinceLast <= 3) {
    return 'high';
  }

  // Medium confidence: at least 4 entries in last 60 days AND last entry within 7 days
  if (entriesLast60Days >= 4 && daysSinceLast !== null && daysSinceLast <= 7) {
    return 'medium';
  }

  // Low confidence: otherwise
  return 'low';
}

