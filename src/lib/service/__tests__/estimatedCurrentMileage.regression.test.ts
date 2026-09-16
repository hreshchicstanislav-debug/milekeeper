import { describe, it, expect } from 'vitest';
import type { OdometerEntry, ServiceEvent, ServiceItem } from '@/lib/db/types';
import { computeEstimatedOdometer } from '@/lib/service/estimatedOdometer';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';

/**
 * Regression test for the core bug: without new manual odometer input the whole
 * maintenance forecast used to freeze, while the predicted due date silently slid
 * one day forward every day.
 *
 * dailyRate is pinned to a constant here on purpose: the rolling 60-day model is
 * already covered by mileageAndForecastToBe.test.ts, and this test must assert exact
 * numbers that do not depend on how the window happens to recompute.
 */

const DAILY_RATE = 40;

const LAST_ACTUAL_KM = 467910;
const DAY_D = new Date(2026, 2, 1, 12, 0, 0); // 2026-03-01, local
const DAY_D_PLUS_7 = new Date(2026, 2, 8, 12, 0, 0); // 2026-03-08, local

function odometerEntry(occurredAt: Date, mileageKm: number): OdometerEntry {
  const iso = occurredAt.toISOString();
  return {
    id: `${iso}:${mileageKm}`,
    user_id: 'user-1',
    occurred_at: iso,
    mileage_km: mileageKm,
    note: null,
    created_at: iso,
  };
}

const lastActualEntry = odometerEntry(new Date(2026, 2, 1, 9, 0, 0), LAST_ACTUAL_KM);

// km-mode item: replaced at 460 000 km, interval 10 000 km => due at 470 000 km
const kmItem: ServiceItem = {
  id: 'item-1',
  user_id: 'user-1',
  title: 'Масло двигателя',
  interval_km: 10000,
  interval_days: null,
  notify_before_days: 7,
  notify_before_km: null,
  measurement_mode: 'km',
  note: null,
  is_active: true,
  created_at: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
};

const lastEvent: ServiceEvent = {
  id: 'event-1',
  user_id: 'user-1',
  service_item_id: 'item-1',
  occurred_at: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
  mileage_km: 460000,
  note: null,
  created_at: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
};

function statusAt(now: Date, currentMileageKm: number | null) {
  return calcServiceStatus({
    serviceItem: kmItem,
    latestOdometerMileageKm: currentMileageKm,
    lastEvent,
    dailyKmRate: DAILY_RATE,
    now,
  });
}

/** For km-mode items calcServiceStatus exposes the predicted due date as secondary.dueValue */
function dueByKmDate(result: ReturnType<typeof calcServiceStatus>): Date {
  expect(result.secondary).toBeDefined();
  expect(result.secondary!.kind).toBe('time');
  return new Date(result.secondary!.dueValue as number);
}

describe('estimated current mileage drives the forecast forward over time', () => {
  it('advances the estimated odometer by 7 x dailyRate after a week without input', () => {
    const atD = computeEstimatedOdometer(lastActualEntry, DAILY_RATE, DAY_D);
    const atD7 = computeEstimatedOdometer(lastActualEntry, DAILY_RATE, DAY_D_PLUS_7);

    expect(atD.estimatedKm).toBe(LAST_ACTUAL_KM);
    expect(atD.isEstimated).toBe(false);

    expect(atD7.elapsedDays).toBe(7);
    expect(atD7.estimatedKm).toBe(LAST_ACTUAL_KM + 7 * DAILY_RATE); // 468 190
    expect(atD7.isEstimated).toBe(true);

    // The confirmed fact itself is never moved by the app
    expect(atD7.lastActualKm).toBe(LAST_ACTUAL_KM);
    expect(atD7.lastActualAt).toBe(lastActualEntry.occurred_at);
  });

  it('reduces remainingKm and remainingDays as time passes', () => {
    const atD = statusAt(DAY_D, computeEstimatedOdometer(lastActualEntry, DAILY_RATE, DAY_D).estimatedKm);
    const atD7 = statusAt(
      DAY_D_PLUS_7,
      computeEstimatedOdometer(lastActualEntry, DAILY_RATE, DAY_D_PLUS_7).estimatedKm
    );

    // 470 000 - 467 910 = 2090 -> ceil(2090 / 40) = 53
    expect(atD.remainingKm).toBe(2090);
    expect(atD.remainingDays).toBe(53);

    // 470 000 - 468 190 = 1810 -> ceil(1810 / 40) = 46
    expect(atD7.remainingKm).toBe(1810);
    expect(atD7.remainingDays).toBe(46);

    expect(atD.remainingKm! - atD7.remainingKm!).toBe(7 * DAILY_RATE); // 280 km driven
    expect(atD.remainingDays! - atD7.remainingDays!).toBe(7); // forecast moved, not frozen
  });

  it('keeps the predicted due date stable instead of sliding one day forward per day', () => {
    const atD = statusAt(DAY_D, computeEstimatedOdometer(lastActualEntry, DAILY_RATE, DAY_D).estimatedKm);
    const atD7 = statusAt(
      DAY_D_PLUS_7,
      computeEstimatedOdometer(lastActualEntry, DAILY_RATE, DAY_D_PLUS_7).estimatedKm
    );

    const expectedDue = new Date(2026, 3, 23, 0, 0, 0, 0); // 2026-04-23
    expect(dueByKmDate(atD).getTime()).toBe(expectedDue.getTime());
    expect(dueByKmDate(atD7).getTime()).toBe(expectedDue.getTime());
  });

  it('documents the old behaviour: the raw last reading freezes kmLeft and drifts the due date', () => {
    const frozen = statusAt(DAY_D_PLUS_7, LAST_ACTUAL_KM);

    // kmLeft and daysLeft stay exactly where they were a week earlier...
    expect(frozen.remainingKm).toBe(2090);
    expect(frozen.remainingDays).toBe(53);

    // ...and the due date therefore slides 7 days into the future (2026-04-30)
    expect(dueByKmDate(frozen).getTime()).toBe(new Date(2026, 3, 30, 0, 0, 0, 0).getTime());
  });
});

describe('manual input calibrates the forecast instead of driving it', () => {
  it('makes a new actual reading the anchor immediately on the same local day', () => {
    // User finally looks at the dashboard: the app predicted ~468 190
    const predicted = computeEstimatedOdometer(lastActualEntry, DAILY_RATE, DAY_D_PLUS_7);
    expect(predicted.estimatedKm).toBe(468190);

    // ...but the real odometer shows 468 000 (lower than predicted, still above the last fact)
    const recalibrated = odometerEntry(new Date(2026, 2, 8, 18, 0, 0), 468000);
    const afterInput = computeEstimatedOdometer(recalibrated, DAILY_RATE, DAY_D_PLUS_7);

    expect(afterInput.elapsedDays).toBe(0);
    expect(afterInput.estimatedKm).toBe(468000); // position corrects instantly
    expect(afterInput.lastActualKm).toBe(468000);
    expect(afterInput.isEstimated).toBe(false);

    // And the forecast now runs from the corrected position
    const status = statusAt(DAY_D_PLUS_7, afterInput.estimatedKm);
    expect(status.remainingKm).toBe(2000);
    expect(status.remainingDays).toBe(50); // ceil(2000 / 40)
  });

  it('starts extrapolating again from the new anchor on the following days', () => {
    const recalibrated = odometerEntry(new Date(2026, 2, 8, 18, 0, 0), 468000);
    const nextDay = computeEstimatedOdometer(recalibrated, DAILY_RATE, new Date(2026, 2, 9, 8, 0, 0));

    expect(nextDay.elapsedDays).toBe(1);
    expect(nextDay.estimatedKm).toBe(468040);
    expect(nextDay.isEstimated).toBe(true);
  });
});
