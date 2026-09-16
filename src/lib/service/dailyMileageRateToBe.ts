/**
 * TO-BE (MVP): Daily mileage rate calculation
 *
 * Source of truth: docs/calculations/mileage-and-forecast-to-be.md
 *
 * Key rules:
 * - Rolling 60 calendar days relative to `now` (single time source passed in)
 * - Day-bucket grouping by LOCAL calendar date (environment/user locale timezone)
 * - For each day: startKmDay = MIN(mileage_km), endKmDay = MAX(mileage_km)
 * - avgKmPerDay = (endKm(lastDay) - startKm(firstDay)) / daysSpan
 *   where daysSpan = (lastDay - firstDay) + 1 (inclusive)
 * - Minimum data: at least 2 different days AND totalKm > 0, otherwise insufficient
 * - Fallback: last 14 active days (days with data), daysSpan is calendar span between first/last active day (inclusive)
 */

import type { OdometerEntry } from '@/lib/db/types';

export type DailyRateInsufficientReason =
  | 'insufficient_data'
  | 'insufficient_days'
  | 'non_positive_total_km';

export interface DailyMileageRateResult {
  dailyRate: number | null; // avgKmPerDay
  isFallback: boolean;
  firstDay: string | null; // YYYY-MM-DD (local)
  lastDay: string | null; // YYYY-MM-DD (local)
  daysSpan: number | null; // inclusive calendar span between firstDay and lastDay
  reason?: DailyRateInsufficientReason;
}

type DayKey = string; // YYYY-MM-DD in local time

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Convert Date to local day key YYYY-MM-DD (local timezone). */
export function toLocalDayKey(d: Date): DayKey {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

/** Parse a local day key (YYYY-MM-DD) into a Date at local midnight. */
export function fromLocalDayKey(dayKey: DayKey): Date {
  const [y, m, d] = dayKey.split('-').map((x) => parseInt(x, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function diffCalendarDaysInclusive(firstDay: DayKey, lastDay: DayKey): number {
  const a = fromLocalDayKey(firstDay).getTime();
  const b = fromLocalDayKey(lastDay).getTime();
  const days = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return days + 1;
}

type DayBucket = { day: DayKey; startKmDay: number; endKmDay: number };

function buildDayBuckets(entries: OdometerEntry[], now: Date): DayBucket[] {
  // Only occurred_at is used. Exclude future entries relative to `now`.
  const byDay = new Map<DayKey, { min: number; max: number }>();

  for (const e of entries) {
    const occurred = new Date(e.occurred_at);
    if (occurred.getTime() > now.getTime()) continue;

    const day = toLocalDayKey(occurred);
    const existing = byDay.get(day);
    if (!existing) {
      byDay.set(day, { min: e.mileage_km, max: e.mileage_km });
    } else {
      if (e.mileage_km < existing.min) existing.min = e.mileage_km;
      if (e.mileage_km > existing.max) existing.max = e.mileage_km;
    }
  }

  const buckets: DayBucket[] = [];
  for (const [day, v] of byDay.entries()) {
    buckets.push({ day, startKmDay: v.min, endKmDay: v.max });
  }

  buckets.sort((a, b) => fromLocalDayKey(a.day).getTime() - fromLocalDayKey(b.day).getTime());
  return buckets;
}

function computeFromBuckets(buckets: DayBucket[], isFallback: boolean): DailyMileageRateResult {
  if (buckets.length < 2) {
    return {
      dailyRate: null,
      isFallback,
      firstDay: buckets[0]?.day ?? null,
      lastDay: buckets[buckets.length - 1]?.day ?? null,
      daysSpan: null,
      reason: 'insufficient_days',
    };
  }

  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const firstDay = first.day;
  const lastDay = last.day;
  const daysSpan = diffCalendarDaysInclusive(firstDay, lastDay);

  const totalKm = last.endKmDay - first.startKmDay;
  if (totalKm <= 0) {
    return {
      dailyRate: null,
      isFallback,
      firstDay,
      lastDay,
      daysSpan,
      reason: 'non_positive_total_km',
    };
  }

  if (daysSpan < 2) {
    return {
      dailyRate: null,
      isFallback,
      firstDay,
      lastDay,
      daysSpan,
      reason: 'insufficient_days',
    };
  }

  return {
    dailyRate: totalKm / daysSpan,
    isFallback,
    firstDay,
    lastDay,
    daysSpan,
  };
}

/**
 * Calculate TO-BE daily mileage rate.
 *
 * @param entries odometer entries (any order)
 * @param now single canonical now (e.g. getAppNow())
 */
export function calculateDailyMileageRateToBe(
  entries: OdometerEntry[],
  now: Date
): DailyMileageRateResult {
  // Rolling 60 calendar days relative to TODAY (local).
  const todayKey = toLocalDayKey(now);
  const todayMidnight = fromLocalDayKey(todayKey);
  const cutoffMidnight = new Date(todayMidnight);
  cutoffMidnight.setDate(cutoffMidnight.getDate() - 60);

  const allBuckets = buildDayBuckets(entries, now);

  // Keep only buckets within [cutoffDate, today] inclusive
  const windowBuckets = allBuckets.filter((b) => {
    const t = fromLocalDayKey(b.day).getTime();
    return t >= cutoffMidnight.getTime() && t <= todayMidnight.getTime();
  });

  const primary = computeFromBuckets(windowBuckets, false);
  if (primary.dailyRate !== null) {
    return primary;
  }

  // Fallback: last 14 active days (active = day with data), but daysSpan is calendar span between first/last.
  const last14 = allBuckets.slice(-14);
  const fallback = computeFromBuckets(last14, true);
  if (fallback.dailyRate !== null) {
    return fallback;
  }

  return {
    dailyRate: null,
    isFallback: false,
    firstDay: null,
    lastDay: null,
    daysSpan: null,
    reason: 'insufficient_data',
  };
}

