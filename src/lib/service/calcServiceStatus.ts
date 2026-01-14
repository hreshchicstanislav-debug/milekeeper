/**
 * Service status calculation helper with limiting factor concept
 * Determines which criterion (km or time) is the primary limiting factor
 * and calculates status based on that factor only.
 */

import type { ServiceItem, ServiceEvent } from '@/lib/db/types';
import { toLocalDayKey } from '@/lib/service/dailyMileageRateToBe';

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
  dailyKmRate?: number | null; // TO-BE: avgKmPerDay (nullable => insufficient data)
  now: Date; // TO-BE: single canonical now is required at call sites
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
 * TO-BE: Add calendar days while treating Feb 29 as a non-counted day.
 * This matches the TO-BE acceptance scenario where interval_days=365 maps to the same calendar date next year
 * even in leap years.
 */
function addCalendarDaysSkippingLeap(baseLocalMidnight: Date, intervalDays: number): Date {
  const d = new Date(baseLocalMidnight);
  let remaining = intervalDays;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    // Skip counting Feb 29 (leap day) toward interval_days
    if (d.getMonth() === 1 && d.getDate() === 29) {
      continue;
    }
    remaining -= 1;
  }
  return d;
}

/**
 * Calculate service status with limiting factor logic
 */
export function calcServiceStatus(input: CalcInput): ServiceStatusResult {
  // TO-BE: single source of time. `now` is provided by call sites (no implicit new Date()).
  const { serviceItem, latestOdometerMileageKm, lastEvent, dailyKmRate = null, now } = input;
  
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

  // TO-BE: derive local `today` from `now` (single time source), as a local calendar date.
  const todayKey = toLocalDayKey(now);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  // Compute remaining km if interval_km exists and we have current mileage
  let kmLeft: number | null = null;
  let nextServiceKm: number | null = null;
  if (serviceItem.interval_km !== null && latestOdometerMileageKm !== null) {
    nextServiceKm = lastServiceMileage + serviceItem.interval_km;
    kmLeft = nextServiceKm - latestOdometerMileageKm;
  }

  // TO-BE: compute time-based dueDate strictly by local calendar date + intervalDays
  let dueDateTime: Date | null = null;
  let daysLeftTime: number | null = null;
  if (serviceItem.interval_days !== null) {
    const lastServiceDayKey = toLocalDayKey(lastServiceDate);
    const lastServiceMidnight = new Date(
      lastServiceDate.getFullYear(),
      lastServiceDate.getMonth(),
      lastServiceDate.getDate(),
      0,
      0,
      0,
      0
    );
    // (lastServiceDayKey kept for debugging/logging parity; lastServiceMidnight is the actual base)
    void lastServiceDayKey;

    dueDateTime = addCalendarDaysSkippingLeap(lastServiceMidnight, serviceItem.interval_days);
    daysLeftTime = Math.round((dueDateTime.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
  }

  // TO-BE: km-mode daysLeft = ceil(kmLeft / dailyRate) only if dailyRate is valid (>0)
  let daysLeftKm: number | null = null;
  if (kmLeft !== null && dailyKmRate !== null && typeof dailyKmRate === 'number' && Number.isFinite(dailyKmRate) && dailyKmRate > 0) {
    daysLeftKm = Math.ceil(kmLeft / dailyKmRate);
  }

  // TO-BE: due-by-km date uses baseDate = today (local) + daysLeftKm
  let dueByKmDate: Date | null = null;
  if (daysLeftKm !== null) {
    dueByKmDate = new Date(todayMidnight);
    dueByKmDate.setDate(dueByKmDate.getDate() + daysLeftKm);
  }

  // STRICT BRANCHING: Determine limiting factor based on measurement_mode
  // TO-BE: limiting factor is determined by earliest due date when BOTH criteria exist.
  let limitingFactor: LimitingFactor = 'none';
  let primaryRemaining: number | null = null;
  let primaryDue: number | null = null;
  let primaryKind: 'km' | 'time' = 'km';
  let secondaryRemaining: number | null = null;
  let secondaryDue: number | null = null;
  let secondaryKind: 'km' | 'time' | null = null;

  const hasKmCriterion = serviceItem.interval_km !== null;
  const hasTimeCriterion = serviceItem.interval_days !== null;

  // If no criteria effectively available (should be prevented by DB constraint, but guard anyway)
  if (!hasKmCriterion && !hasTimeCriterion) {
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
      why: 'Нет данных об интервалах обслуживания',
      remainingKm: null,
      remainingDays: null,
    };
  }

  // For km-mode items, primary is km criterion (time may exist but is secondary by TO-BE display rule).
  if (serviceItem.measurement_mode === 'km') {
    if (kmLeft === null || nextServiceKm === null) {
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
        why: latestOdometerMileageKm === null ? 'Нет данных о текущем пробеге' : 'Нет данных для расчёта по пробегу',
        remainingKm: null,
        remainingDays: null,
      };
    }

    limitingFactor = 'km';
    primaryKind = 'km';
    primaryRemaining = kmLeft;
    primaryDue = nextServiceKm;

    // Secondary (days forecast) only if dailyRate is available
    if (daysLeftKm !== null) {
      secondaryKind = 'time';
      secondaryRemaining = daysLeftKm;
      secondaryDue = dueByKmDate ? dueByKmDate.getTime() : null;
    }
  } else {
    // calendar measurement_mode: may be time-only, km-only, or mixed.
    const dueByTimeDate = dueDateTime;

    if (hasKmCriterion && hasTimeCriterion) {
      // Mixed: choose earlier due date among km and time (if km due date available).
      if (dueByKmDate !== null && dueByTimeDate !== null) {
        if (dueByKmDate.getTime() < dueByTimeDate.getTime()) {
          limitingFactor = 'km';
          primaryKind = 'km';
          primaryRemaining = kmLeft;
          primaryDue = nextServiceKm;
          secondaryKind = 'time';
          secondaryRemaining = daysLeftTime;
          secondaryDue = dueByTimeDate.getTime();
        } else {
          limitingFactor = 'time';
          primaryKind = 'time';
          primaryRemaining = daysLeftTime;
          primaryDue = dueByTimeDate.getTime();
          secondaryKind = 'km';
          secondaryRemaining = kmLeft;
          secondaryDue = nextServiceKm;
        }
      } else if (dueByTimeDate !== null) {
        // Time is available but km due date isn't (insufficient dailyRate) => time is limiting by availability.
          limitingFactor = 'time';
          primaryKind = 'time';
        primaryRemaining = daysLeftTime;
        primaryDue = dueByTimeDate.getTime();
        // Secondary km shown if kmLeft exists
        if (kmLeft !== null && nextServiceKm !== null) {
          secondaryKind = 'km';
          secondaryRemaining = kmLeft;
          secondaryDue = nextServiceKm;
        }
      } else if (dueByKmDate !== null) {
        // Km due date exists but time doesn't (shouldn't happen if interval_days exists, but guard)
        limitingFactor = 'km';
        primaryKind = 'km';
        primaryRemaining = kmLeft;
        primaryDue = nextServiceKm;
      } else {
        // Neither due date available (no time due date and no km due date) => unknown
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
          why: 'Недостаточно данных для прогноза',
          remainingKm: kmLeft,
          remainingDays: null,
        };
      }
    } else if (hasTimeCriterion) {
      // Time-only
      if (dueByTimeDate === null || daysLeftTime === null) {
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
          why: 'Недостаточно данных для расчёта по времени',
          remainingKm: kmLeft,
          remainingDays: null,
        };
      }
      limitingFactor = 'time';
      primaryKind = 'time';
      primaryRemaining = daysLeftTime;
      primaryDue = dueByTimeDate.getTime();
    } else {
      // Km-only (calendar mode with interval_km but no interval_days)
      if (kmLeft === null || nextServiceKm === null) {
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
          why: latestOdometerMileageKm === null ? 'Нет данных о текущем пробеге' : 'Нет данных для расчёта по пробегу',
          remainingKm: null,
        remainingDays: null,
      };
      }
      limitingFactor = 'km';
      primaryKind = 'km';
      primaryRemaining = kmLeft;
      primaryDue = nextServiceKm;
      if (daysLeftKm !== null) {
        secondaryKind = 'time';
        secondaryRemaining = daysLeftKm;
        secondaryDue = dueByKmDate ? dueByKmDate.getTime() : null;
      }
    }
  }

  // Determine status based on ANY available criterion (not just limiting factor)
  // TO-BE: OVERDUE rules:
  // - km criterion: overdue if kmLeft <= 0
  // - time criterion: overdue if dueDate < today (i.e., daysLeftTime < 0)
  // SOON: if NOT OVERDUE and ANY remaining value <= its threshold
  // OK: otherwise
  
  const isOverdueByKm = kmLeft !== null && kmLeft <= 0;
  const isOverdueByTime = daysLeftTime !== null && daysLeftTime < 0;
  
  // TO-BE: SOON is days-threshold based (notify_before_days) for both km and time,
  // but only when the corresponding daysLeft is available (km days can be null on insufficient dailyRate).
  const isSoonByKmDays =
    daysLeftKm !== null &&
    daysLeftKm >= 0 &&
    daysLeftKm <= serviceItem.notify_before_days &&
    !isOverdueByKm;
  const isSoonByTimeDays =
    daysLeftTime !== null &&
    daysLeftTime >= 0 &&
    daysLeftTime <= serviceItem.notify_before_days &&
    !isOverdueByTime;
  
  let status: Status;
  if (isOverdueByKm || isOverdueByTime) {
    status = 'OVERDUE';
  } else if (isSoonByKmDays || isSoonByTimeDays) {
    status = 'SOON';
  } else {
    status = 'OK';
  }

  // Generate explanation string (based on measurement_mode and actual triggers)
  let why: string;
  if (status === 'OVERDUE') {
    if (serviceItem.measurement_mode === 'km') {
      if (kmLeft !== null && kmLeft <= 0) {
        why = `Просрочено по пробегу: ${kmLeft.toFixed(0)} км`;
      } else {
        why = 'Просрочено';
      }
    } else {
      // calendar mode
      why = `Просрочено по календарю: ${daysLeftTime !== null ? daysLeftTime.toFixed(0) : '?'} дней`;
    }
  } else if (status === 'SOON') {
    if (serviceItem.measurement_mode === 'km') {
      if (daysLeftKm !== null) {
        why = `Скоро по прогнозу: осталось ${daysLeftKm.toFixed(0)} дн (порог: ${serviceItem.notify_before_days} дн)`;
      } else {
        why = 'Недостаточно данных для прогноза';
      }
    } else {
      // calendar mode
      why = `Скоро по календарю: ${daysLeftTime !== null ? daysLeftTime.toFixed(0) : '?'} дней (порог: ${serviceItem.notify_before_days} дней)`;
    }
  } else {
    // OK status
    if (serviceItem.measurement_mode === 'km') {
      const okParts: string[] = [];
      if (kmLeft !== null) {
        okParts.push(`${kmLeft.toFixed(0)} км`);
      }
      if (daysLeftKm !== null) {
        okParts.push(`~${daysLeftKm.toFixed(0)} дн.`);
      } else if (dailyKmRate === null) {
        okParts.push('недостаточно данных');
      }
      why = okParts.length > 0 ? `Осталось ${okParts.join(' / ')}` : 'OK';
    } else {
      // calendar mode
      why = `Осталось ${daysLeftTime !== null ? daysLeftTime.toFixed(0) : '?'} дней`;
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
    remainingKm: kmLeft,
    // TO-BE: remainingDays is the currently displayed days-left value:
    // - for km-mode: daysLeftKm (nullable if insufficient dailyRate)
    // - for time-mode: daysLeftTime
    // - for mixed: days-left for the limiting factor
    remainingDays:
      limitingFactor === 'time'
        ? daysLeftTime
        : limitingFactor === 'km'
          ? daysLeftKm
          : null,
  };
  
  // Add predictedDaysFromKm and dailyKmRateUsed for km mode (for debugging)
  if (serviceItem.measurement_mode === 'km') {
    // TO-BE: predictedDaysFromKm equals daysLeftKm (integer, ceil), or null if insufficient data.
    result.predictedDaysFromKm = daysLeftKm;
    // TO-BE: store the rate actually used (no implicit fallback in forecast; null means insufficient)
    result.dailyKmRateUsed = dailyKmRate;
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

