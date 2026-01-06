/**
 * View-Model layer for Service Item Status UI (v1)
 * 
 * Implements Target UI (v1) specification from docs/elements-status-ui-v1.md
 * 
 * This module provides a view-model function that prepares data for the new
 * elements list UI without changing the existing business logic or UI components.
 */

import type { ServiceItem } from '../db/types';
import type { ServiceStatusResult } from './calcServiceStatus';
import type { ConfidenceLevel } from '../prediction/dailyRate';

/**
 * Context data for building the view-model
 * Contains all necessary data that is available in the current codebase
 */
export interface ServiceItemStatusVMContext {
  /** Measurement mode: 'km' or 'calendar' */
  measurement_mode: 'km' | 'calendar';
  /** Interval in kilometers (null if not applicable) */
  interval_km: number | null;
  /** Interval in days (null if not applicable) */
  interval_days: number | null;
  /** Notify before days threshold */
  notify_before_days: number;
  /** Daily km rate for forecasting (used for km mode) */
  dailyKmRate: number | null;
  /** Whether the daily km rate is a fallback value (30 km/day) */
  isFallbackRate?: boolean;
  /** Confidence level for prediction (optional, may not be available) */
  confidence?: ConfidenceLevel;
}

/**
 * View-Model for Service Item Status UI (v1)
 * 
 * Contains all data needed to render an item in the new list UI:
 * - Status text and color
 * - Progress bar data
 * - Prediction reliability
 */
export interface ServiceItemStatusVM {
  /** Days until next replacement (null if unavailable) */
  daysToReplace: number | null;
  /** Total interval in days (null if unavailable) */
  totalDays: number | null;
  /** Remaining ratio (0.0 = due now, 1.0 = just replaced, can be negative for overdue) */
  remainingRatio: number | null;
  /** Status color for UI */
  statusColor: 'green' | 'yellow' | 'orange' | 'red';
  /** Status text for display */
  statusText: string;
  /** Whether the prediction is reliable */
  isPredictionReliable: boolean;
}

/**
 * Build Service Item Status View-Model
 * 
 * Implements Target UI (v1) specification from docs/elements-status-ui-v1.md
 * 
 * @param serviceItem Service item data
 * @param statusResult Result from calcServiceStatus()
 * @param context Context data (measurement_mode, intervals, dailyKmRate, etc.)
 * @returns View-model with all fields needed for UI rendering
 */
export function buildServiceItemStatusVM(
  serviceItem: ServiceItem,
  statusResult: ServiceStatusResult,
  context: ServiceItemStatusVMContext
): ServiceItemStatusVM {
  // Extract daysToReplace from statusResult.remainingDays
  // This is already computed correctly for both 'km' and 'calendar' modes
  const daysToReplace = statusResult.remainingDays;

  // Calculate totalDays based on measurement_mode
  let totalDays: number | null = null;
  
  if (context.measurement_mode === 'calendar') {
    // Calendar mode: use interval_days directly
    totalDays = context.interval_days;
  } else if (context.measurement_mode === 'km') {
    // Km mode: calculate totalDays from interval_km / avgDailyKm
    if (context.interval_km !== null && context.interval_km > 0) {
      // Use dailyKmRate from context, with fallback to 30 if needed
      const rateToUse = context.dailyKmRate !== null && context.dailyKmRate > 0
        ? context.dailyKmRate
        : 30; // Fallback
      
      totalDays = context.interval_km / rateToUse;
    }
  }

  // Calculate remainingRatio = daysToReplace / totalDays
  let remainingRatio: number | null = null;
  if (daysToReplace !== null && totalDays !== null && totalDays > 0) {
    remainingRatio = daysToReplace / totalDays;
  }

  // Determine if prediction is reliable
  // According to spec: unreliable if isFallbackRate===true OR dailyKmRateUsed===30 OR confidence==='low'
  // Note: All conditions must be checked (undefined/null are treated as reliable)
  const isPredictionReliable = !(
    context.isFallbackRate === true ||
    (statusResult.dailyKmRateUsed !== null && statusResult.dailyKmRateUsed !== undefined && statusResult.dailyKmRateUsed === 30) ||
    context.confidence === 'low'
  );

  // Determine statusColor based on status and remainingRatio
  let statusColor: 'green' | 'yellow' | 'orange' | 'red';
  
  if (statusResult.status === 'OVERDUE') {
    // OVERDUE always red
    statusColor = 'red';
  } else if (remainingRatio === null) {
    // Unreliable data -> yellow
    statusColor = 'yellow';
  } else if (remainingRatio > 0.25) {
    // >25% remaining -> green
    statusColor = 'green';
  } else if (remainingRatio > 0.10) {
    // 10-25% remaining -> yellow
    statusColor = 'yellow';
  } else if (remainingRatio > 0.03) {
    // 3-10% remaining -> orange
    statusColor = 'orange';
  } else {
    // <3% remaining -> red
    statusColor = 'red';
  }

  // Determine statusText
  let statusText: string;
  
  if (!isPredictionReliable) {
    // Unreliable prediction -> "Скоро" without days
    statusText = 'Скоро';
  } else if (statusResult.status === 'OVERDUE') {
    // Overdue -> "Просрочено"
    statusText = 'Просрочено';
  } else if (daysToReplace !== null) {
    // Reliable prediction -> "~N дней" (rounded to integer)
    const daysRounded = Math.round(daysToReplace);
    statusText = `~${daysRounded} дней`;
  } else {
    // No data available -> fallback text
    statusText = 'Скоро';
  }

  return {
    daysToReplace,
    totalDays,
    remainingRatio,
    statusColor,
    statusText,
    isPredictionReliable,
  };
}

