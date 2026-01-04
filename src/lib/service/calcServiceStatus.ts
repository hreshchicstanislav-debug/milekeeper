/**
 * Service status calculation helper with limiting factor concept
 * Determines which criterion (km or time) is the primary limiting factor
 * and calculates status based on that factor only.
 */

import type { ServiceItem, ServiceEvent } from '@/lib/db/types';

export type LimitingFactor = 'km' | 'time' | 'none';
export type Status = 'OVERDUE' | 'SOON' | 'OK' | 'UNKNOWN';

export interface PrimaryMetric {
  kind: 'km' | 'time';
  remainingValue: number;
  dueValue: number; // For km: mileage in km; for time: timestamp in ms
  dueDate?: Date; // Optional: computed date for km-based (if dailyRate available)
  unit: string;
  label: string;
}

export interface SecondaryMetric {
  kind: 'km' | 'time';
  remainingValue: number | null;
  dueValue: number | null; // For km: mileage in km; for time: timestamp in ms
  unit: string;
  label: string;
}

export interface ServiceStatusResult {
  status: Status;
  limitingFactor: LimitingFactor;
  primary: PrimaryMetric;
  secondary?: SecondaryMetric;
  why: string;
  // Raw values for sorting (both criteria)
  remainingKm: number | null;
  remainingDays: number | null; // Semantic: calendar days for 'calendar' mode, predicted days for 'km' mode
  predictedDaysFromKm?: number | null; // Predicted days from km (only for 'km' mode)
  dailyKmRateUsed?: number | null; // Daily km rate used for prediction
}

interface CalcInput {
  serviceItem: ServiceItem;
  latestOdometerMileageKm: number | null;
  lastEvent: ServiceEvent | null;
  dailyKmRate?: number | null; // Average km/day for forecasting (optional)
  now?: Date;
}

/**
 * Round days to avoid -0 artifacts
 */
function roundDays(days: number): number {
  if (days === 0) return 0;
  if (days < 0 && days > -0.5) return 0;
  return Math.round(days * 100) / 100; // Round to 2 decimals to avoid floating point issues
}

/**
 * Calculate service status with limiting factor logic
 */
export function calcServiceStatus(input: CalcInput): ServiceStatusResult {
  const { serviceItem, latestOdometerMileageKm, lastEvent, dailyKmRate = null, now = new Date() } = input;
  
  // Dev-only: validate dailyKmRate type (should be number or null)
  if (process.env.NODE_ENV !== 'production') {
    if (dailyKmRate !== null && typeof dailyKmRate !== 'number') {
      console.warn('[calcServiceStatus] Invalid dailyKmRate type:', {
        itemTitle: serviceItem.title,
        dailyKmRate,
        dailyKmRateType: typeof dailyKmRate,
      });
    }
  }

  // If no last event, status is UNKNOWN
  if (!lastEvent) {
    return {
      status: 'UNKNOWN',
      limitingFactor: 'none',
      primary: {
        kind: 'km',
        remainingValue: 0,
        dueValue: 0,
        unit: 'км',
        label: 'По пробегу',
      },
      why: 'Нет данных о последней замене',
      remainingKm: null,
      remainingDays: null,
    };
  }

  const lastServiceMileage = lastEvent.mileage_km;
  const lastServiceDate = new Date(lastEvent.occurred_at);

  // Compute remaining km if interval_km exists and we have current mileage
  let remainingKm: number | null = null;
  let dueMileageKm: number | null = null;
  if (serviceItem.interval_km !== null && latestOdometerMileageKm !== null) {
    dueMileageKm = lastServiceMileage + serviceItem.interval_km;
    remainingKm = dueMileageKm - latestOdometerMileageKm;
  }

  // STRICT BRANCHING: Compute remaining days based on measurement_mode
  // For 'km' mode: NEVER compute dueDate (time-based deadline doesn't exist)
  // For 'calendar' mode: compute dueDate from lastEvent + interval_days
  let remainingDays: number | null = null;
  let predictedDaysFromKm: number | null = null;
  let dueDate: Date | null = null;
  
  if (serviceItem.measurement_mode === 'km') {
    // Km mode: predict days from remainingKm using dailyKmRate
    // remainingDays MUST be computed if remainingKm exists (it's the public field for UI)
    // NOTE: dueDate is NEVER computed for km mode (no time-based deadline)
    if (remainingKm !== null && Number.isFinite(remainingKm)) {
      // Validate and normalize dailyKmRate BEFORE division
      // Ensure dailyKmRate is a finite positive number, otherwise use fallback
      let rateToUse: number;
      if (dailyKmRate !== null && typeof dailyKmRate === 'number' && Number.isFinite(dailyKmRate) && dailyKmRate > 0) {
        rateToUse = dailyKmRate;
      } else {
        // Fallback to 30 km/day if dailyKmRate is invalid
        rateToUse = 30;
        
        // Dev-only: warn if fallback is used
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[calcServiceStatus] km mode: using fallback rate (30 km/day)', {
            itemTitle: serviceItem.title,
            dailyKmRate,
            dailyKmRateType: typeof dailyKmRate,
            remainingKm,
          });
        }
      }
      
      // Calculate predicted days (use division to preserve precision and sign)
      // remainingKm can be negative (overdue), so predictedDaysFromKm will also be negative
      predictedDaysFromKm = remainingKm / rateToUse;
      
      // Normalize near-zero (only for values very close to 0, preserve sign otherwise)
      if (Math.abs(predictedDaysFromKm) < 0.01) {
        predictedDaysFromKm = 0;
      }
      
      // Ensure remainingDays is set (this is the public field for UI)
      // IMPORTANT: remainingDays must never be null for km-mode if remainingKm exists and is finite
      // IMPORTANT: Do NOT clamp to >=0 - negative values indicate overdue status
      remainingDays = predictedDaysFromKm;
      
      // Final safety check: ensure remainingDays is finite (should always be true after division)
      if (!Number.isFinite(remainingDays)) {
        // This should never happen, but if it does, use fallback calculation
        if (process.env.NODE_ENV !== 'production') {
          console.error('[calcServiceStatus] km mode: remainingDays is not finite after calculation!', {
            itemTitle: serviceItem.title,
            remainingKm,
            rateToUse,
            predictedDaysFromKm,
            remainingDays,
          });
        }
        // Fallback: use a safe value (remainingKm / 30)
        remainingDays = remainingKm / 30;
        predictedDaysFromKm = remainingDays;
      }
    } else {
      // No remainingKm available or remainingKm is not finite, remainingDays stays null
      remainingDays = null;
      predictedDaysFromKm = null;
    }
  } else if (serviceItem.measurement_mode === 'calendar') {
    // Calendar mode: use interval_days directly
    if (serviceItem.interval_days !== null) {
      dueDate = new Date(lastServiceDate);
      dueDate.setDate(dueDate.getDate() + serviceItem.interval_days);
      const daysDiff = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      remainingDays = roundDays(daysDiff);
    } else {
      // Missing interval_days for calendar mode
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[calcServiceStatus] calendar mode: missing interval_days', {
          itemTitle: serviceItem.title,
          itemId: serviceItem.id,
        });
      }
      // Return safe UNKNOWN result
      return {
        status: 'UNKNOWN',
        limitingFactor: 'none',
        primary: {
          kind: 'time',
          remainingValue: 0,
          dueValue: 0,
          unit: 'дней',
          label: 'По времени',
        },
        why: 'Нет данных об интервале в днях для режима "По календарю"',
        remainingKm: remainingKm,
        remainingDays: null,
      };
    }
  }

  // STRICT BRANCHING: Determine limiting factor based on measurement_mode
  // For 'km' mode: limitingFactor can ONLY be 'km' (never 'time')
  // For 'calendar' mode: limitingFactor can be 'time' or 'km' (if both intervals exist)
  let limitingFactor: LimitingFactor = 'none';
  let primaryRemaining: number | null = null;
  let primaryDue: number | null = null;
  let primaryKind: 'km' | 'time' = 'km';
  let secondaryRemaining: number | null = null;
  let secondaryDue: number | null = null;
  let secondaryKind: 'km' | 'time' | null = null;

  if (serviceItem.measurement_mode === 'km') {
    // Km mode: limitingFactor is ALWAYS 'km' (never 'time')
    // We can have remainingDays (predicted), but it's never the limiting factor
    if (remainingKm !== null) {
      limitingFactor = 'km';
      primaryRemaining = remainingKm;
      primaryDue = dueMileageKm!;
      primaryKind = 'km';
      // Add predicted days as secondary if available
      if (remainingDays !== null) {
        secondaryRemaining = remainingDays;
        secondaryKind = 'time';
        // For km mode, secondaryDue is not a real dueDate, use a placeholder
        // (we don't have a real dueDate for predicted days)
        secondaryDue = null; // No real dueDate for predicted days
      }
    } else {
      // No remainingKm available
      return {
        status: 'UNKNOWN',
        limitingFactor: 'none',
        primary: {
          kind: 'km',
          remainingValue: 0,
          dueValue: 0,
          unit: 'км',
          label: 'По пробегу',
        },
        why: latestOdometerMileageKm === null 
          ? 'Нет данных о текущем пробеге' 
          : 'Нет данных для расчёта по пробегу',
        remainingKm: null,
        remainingDays: null,
      };
    }
  } else if (serviceItem.measurement_mode === 'calendar') {
    // Calendar mode: can have both km and time, or just time
    // dueDate MUST be computed (checked above)
    if (remainingKm !== null && remainingDays !== null && dueDate !== null) {
      // Both available: choose the one that reaches 0 sooner (smaller remaining value)
      // If one is already overdue (<=0), it becomes limiting
      if (remainingKm <= 0 || remainingDays <= 0) {
        // One is overdue: the overdue one is limiting
        if (remainingKm <= 0) {
          limitingFactor = 'km';
          primaryRemaining = remainingKm;
          primaryDue = dueMileageKm!;
          primaryKind = 'km';
          secondaryRemaining = remainingDays;
          secondaryDue = dueDate.getTime();
          secondaryKind = 'time';
        } else {
          limitingFactor = 'time';
          primaryRemaining = remainingDays;
          primaryDue = dueDate.getTime();
          primaryKind = 'time';
          secondaryRemaining = remainingKm;
          secondaryDue = dueMileageKm!;
          secondaryKind = 'km';
        }
      } else {
        // Both positive: choose the one with smaller remaining (will hit 0 sooner)
        if (remainingKm <= remainingDays) {
          limitingFactor = 'km';
          primaryRemaining = remainingKm;
          primaryDue = dueMileageKm!;
          primaryKind = 'km';
          secondaryRemaining = remainingDays;
          secondaryDue = dueDate.getTime();
          secondaryKind = 'time';
        } else {
          limitingFactor = 'time';
          primaryRemaining = remainingDays;
          primaryDue = dueDate.getTime();
          primaryKind = 'time';
          secondaryRemaining = remainingKm;
          secondaryDue = dueMileageKm!;
          secondaryKind = 'km';
        }
      }
    } else if (remainingKm !== null) {
      // Only km available (calendar mode with interval_km but no interval_days - shouldn't happen but safe)
      limitingFactor = 'km';
      primaryRemaining = remainingKm;
      primaryDue = dueMileageKm!;
      primaryKind = 'km';
    } else if (remainingDays !== null && dueDate !== null) {
      // Only time available (calendar mode with interval_days)
      limitingFactor = 'time';
      primaryRemaining = remainingDays;
      primaryDue = dueDate.getTime();
      primaryKind = 'time';
    } else {
      // Neither available (should have been caught above, but safety check)
      return {
        status: 'UNKNOWN',
        limitingFactor: 'none',
        primary: {
          kind: 'time',
          remainingValue: 0,
          dueValue: 0,
          unit: 'дней',
          label: 'По времени',
        },
        why: 'Нет данных для расчёта по календарю',
        remainingKm: remainingKm,
        remainingDays: null,
      };
    }
  }

  // Determine status based on ANY available criterion (not just limiting factor)
  // OVERDUE: if ANY remaining value <= 0
  // SOON: if NOT OVERDUE and ANY remaining value <= its threshold
  // OK: otherwise
  
  // Check for OVERDUE: any criterion is overdue
  const isOverdueByKm = remainingKm !== null && remainingKm <= 0;
  const isOverdueByDays = remainingDays !== null && remainingDays <= 0;
  
  // Check for SOON: based ONLY on notify_before_days (notify_before_km removed from logic)
  // SOON: if NOT OVERDUE and remainingDays <= notify_before_days
  const isSoonByDays = remainingDays !== null && remainingDays <= serviceItem.notify_before_days && !isOverdueByDays;
  
  let status: Status;
  if (isOverdueByKm || isOverdueByDays) {
    status = 'OVERDUE';
  } else if (isSoonByDays) {
    status = 'SOON';
  } else {
    status = 'OK';
  }

  // Generate explanation string (based on measurement_mode and actual triggers)
  let why: string;
  if (status === 'OVERDUE') {
    if (serviceItem.measurement_mode === 'km') {
      if (remainingKm !== null && remainingKm <= 0) {
        why = `Просрочено по пробегу: ${remainingKm.toFixed(0)} км`;
      } else if (remainingDays !== null && remainingDays <= 0) {
        why = `Просрочено по прогнозу дней: ${remainingDays.toFixed(0)} дней`;
      } else {
        why = 'Просрочено';
      }
    } else {
      // calendar mode
      why = `Просрочено по календарю: ${remainingDays !== null ? remainingDays.toFixed(0) : '?'} дней`;
    }
  } else if (status === 'SOON') {
    if (serviceItem.measurement_mode === 'km') {
      // For km-mode: SOON is based on forecast days threshold only
      if (remainingDays !== null) {
        why = `Скоро по прогнозу: осталось ${remainingDays.toFixed(0)} дн (порог: ${serviceItem.notify_before_days} дн)`;
      } else {
        why = 'Скоро';
      }
    } else {
      // calendar mode
      why = `Скоро по календарю: ${remainingDays !== null ? remainingDays.toFixed(0) : '?'} дней (порог: ${serviceItem.notify_before_days} дней)`;
    }
  } else {
    // OK status
    if (serviceItem.measurement_mode === 'km') {
      const okParts: string[] = [];
      if (remainingKm !== null) {
        okParts.push(`${remainingKm.toFixed(0)} км`);
      }
      if (remainingDays !== null) {
        okParts.push(`~${remainingDays.toFixed(0)} дн.`);
      }
      why = okParts.length > 0 ? `Осталось ${okParts.join(' / ')}` : 'OK';
    } else {
      // calendar mode
      why = `Осталось ${remainingDays !== null ? remainingDays.toFixed(0) : '?'} дней`;
    }
  }

  // Build result
  const result: ServiceStatusResult = {
    status,
    limitingFactor,
    primary: {
      kind: primaryKind,
      remainingValue: primaryRemaining!,
      dueValue: primaryDue!,
      unit: primaryKind === 'km' ? 'км' : 'дней',
      label: primaryKind === 'km' ? 'По пробегу' : 'По времени',
    },
    why,
    remainingKm,
    remainingDays,
  };
  
  // Add predictedDaysFromKm and dailyKmRateUsed for km mode (for debugging)
  if (serviceItem.measurement_mode === 'km') {
    result.predictedDaysFromKm = predictedDaysFromKm;
    // Store the rate actually used (with fallback to 30)
    result.dailyKmRateUsed = (dailyKmRate !== null && dailyKmRate > 0) ? dailyKmRate : 30;
  }

  // Add secondary if available
  if (secondaryKind !== null && secondaryRemaining !== null && secondaryDue !== null) {
    result.secondary = {
      kind: secondaryKind,
      remainingValue: secondaryRemaining,
      dueValue: secondaryDue,
      unit: secondaryKind === 'km' ? 'км' : 'дней',
      label: secondaryKind === 'km' ? 'По пробегу' : 'По времени',
    };
  }

  return result;
}

/**
 * Compare two service items by urgency for sorting
 * Returns negative if a should come before b, positive if b should come before a, 0 if equal
 * 
 * Priority order:
 * 1. OVERDUE (most overdue first - more negative remaining)
 * 2. SOON (least remaining first)
 * 3. OK (least remaining first)
 * 4. UNKNOWN (no data - goes to bottom)
 * 
 * Within same status, use urgencyScore based on both criteria (km and days)
 * For stable sorting, use item title as tie-breaker
 */
export function compareServiceUrgency(
  a: { statusResult: ServiceStatusResult; item: ServiceItem },
  b: { statusResult: ServiceStatusResult; item: ServiceItem }
): number {
  const statusA = a.statusResult.status;
  const statusB = b.statusResult.status;

  // Status priority: OVERDUE > SOON > OK > UNKNOWN
  const statusPriority: Record<Status, number> = {
    OVERDUE: 0,
    SOON: 1,
    OK: 2,
    UNKNOWN: 3,
  };

  const priorityA = statusPriority[statusA];
  const priorityB = statusPriority[statusB];

  // Different statuses: sort by priority
  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  // Same status: prioritize days as primary metric, then km
  // For OVERDUE: compare by "how overdue" (more negative = more urgent)
  // For SOON/OK: compare by remainingDays first, then remainingKm
  
  if (statusA === 'OVERDUE') {
    // For OVERDUE: use the more "overdue" value (minimum of both if available)
    const getOverdueSeverity = (result: ServiceStatusResult): number => {
      const values: number[] = [];
      if (result.remainingDays !== null) {
        values.push(result.remainingDays);
      }
      if (result.remainingKm !== null) {
        values.push(result.remainingKm);
      }
      // Return minimum (most negative = most overdue)
      return values.length > 0 ? Math.min(...values) : Infinity;
    };
    
    const severityA = getOverdueSeverity(a.statusResult);
    const severityB = getOverdueSeverity(b.statusResult);
    
    if (severityA !== severityB) {
      return severityA - severityB; // More negative (smaller) = more overdue = higher priority
    }
  } else {
    // For SOON/OK: prioritize remainingDays first (primary metric), then remainingKm
    // Compare by remainingDays first (nulls last)
    if (a.statusResult.remainingDays !== null && b.statusResult.remainingDays !== null) {
      if (a.statusResult.remainingDays !== b.statusResult.remainingDays) {
        return a.statusResult.remainingDays - b.statusResult.remainingDays; // Smaller = more urgent
      }
    } else if (a.statusResult.remainingDays !== null) {
      // A has days, B doesn't -> A is more urgent (has more info)
      return -1;
    } else if (b.statusResult.remainingDays !== null) {
      // B has days, A doesn't -> B is more urgent
      return 1;
    }
    
    // Fallback to remainingKm if days not available
    if (a.statusResult.remainingKm !== null && b.statusResult.remainingKm !== null) {
      if (a.statusResult.remainingKm !== b.statusResult.remainingKm) {
        return a.statusResult.remainingKm - b.statusResult.remainingKm; // Smaller = more urgent
      }
    }
  }

  // Stable tie-breaker: sort by title
  return a.item.title.localeCompare(b.item.title, 'ru');
}

