import { describe, it, expect } from 'vitest';
import type { OdometerEntry } from '@/lib/db/types';
import { computeEstimatedOdometer } from '@/lib/service/estimatedOdometer';

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

describe('computeEstimatedOdometer', () => {
  it('returns no estimate when there is no actual reading', () => {
    const r = computeEstimatedOdometer(null, 40, new Date(2026, 2, 8, 12, 0, 0));

    expect(r.estimatedKm).toBeNull();
    expect(r.lastActualKm).toBeNull();
    expect(r.lastActualAt).toBeNull();
    expect(r.elapsedDays).toBe(0);
    expect(r.dailyRate).toBeNull();
    expect(r.isEstimated).toBe(false);
  });

  it('falls back to the actual reading when dailyRate is null', () => {
    const entry = odometerEntry(new Date(2026, 2, 1, 9, 0, 0), 467910);
    const r = computeEstimatedOdometer(entry, null, new Date(2026, 2, 8, 12, 0, 0));

    expect(r.estimatedKm).toBe(467910);
    expect(r.lastActualKm).toBe(467910);
    expect(r.lastActualAt).toBe(entry.occurred_at);
    expect(r.elapsedDays).toBe(7);
    expect(r.dailyRate).toBeNull();
    expect(r.isEstimated).toBe(false);
  });

  it('falls back to the actual reading when dailyRate is 0', () => {
    const entry = odometerEntry(new Date(2026, 2, 1, 9, 0, 0), 467910);
    const r = computeEstimatedOdometer(entry, 0, new Date(2026, 2, 8, 12, 0, 0));

    expect(r.estimatedKm).toBe(467910);
    expect(r.dailyRate).toBeNull();
    expect(r.isEstimated).toBe(false);
  });

  it('falls back to the actual reading when dailyRate is negative or not finite', () => {
    const entry = odometerEntry(new Date(2026, 2, 1, 9, 0, 0), 467910);
    const now = new Date(2026, 2, 8, 12, 0, 0);

    expect(computeEstimatedOdometer(entry, -10, now).estimatedKm).toBe(467910);
    expect(computeEstimatedOdometer(entry, -10, now).isEstimated).toBe(false);
    expect(computeEstimatedOdometer(entry, NaN, now).estimatedKm).toBe(467910);
    expect(computeEstimatedOdometer(entry, Infinity, now).estimatedKm).toBe(467910);
  });

  it('returns exactly the actual reading when 0 calendar days elapsed', () => {
    const entry = odometerEntry(new Date(2026, 2, 8, 9, 0, 0), 467910);
    // Same local calendar day, later in the day
    const r = computeEstimatedOdometer(entry, 40, new Date(2026, 2, 8, 23, 30, 0));

    expect(r.elapsedDays).toBe(0);
    expect(r.estimatedKm).toBe(467910);
    expect(r.isEstimated).toBe(false);
  });

  it('adds 7 x 40 km after 7 calendar days', () => {
    const entry = odometerEntry(new Date(2026, 2, 1, 9, 0, 0), 467910);
    const r = computeEstimatedOdometer(entry, 40, new Date(2026, 2, 8, 12, 0, 0));

    expect(r.elapsedDays).toBe(7);
    expect(r.estimatedKm).toBe(467910 + 7 * 40); // 468190
    expect(r.dailyRate).toBe(40);
    expect(r.isEstimated).toBe(true);
  });

  it('rounds the estimate to whole kilometres', () => {
    const entry = odometerEntry(new Date(2026, 2, 1, 9, 0, 0), 467910);

    // 3 * 41.4 = 124.2 -> 467910 + 124.2 = 468034.2 -> 468034
    const down = computeEstimatedOdometer(entry, 41.4, new Date(2026, 2, 4, 12, 0, 0));
    expect(down.estimatedKm).toBe(468034);
    expect(Number.isInteger(down.estimatedKm)).toBe(true);

    // 3 * 41.6 = 124.8 -> 467910 + 124.8 = 468034.8 -> 468035
    const up = computeEstimatedOdometer(entry, 41.6, new Date(2026, 2, 4, 12, 0, 0));
    expect(up.estimatedKm).toBe(468035);
    expect(Number.isInteger(up.estimatedKm)).toBe(true);
  });

  it('clamps elapsedDays to 0 for a future-dated actual reading', () => {
    const entry = odometerEntry(new Date(2026, 2, 20, 9, 0, 0), 467910);
    const r = computeEstimatedOdometer(entry, 40, new Date(2026, 2, 8, 12, 0, 0));

    expect(r.elapsedDays).toBe(0);
    expect(r.estimatedKm).toBe(467910);
    expect(r.isEstimated).toBe(false);
  });

  it('never returns an estimate below the last actual reading', () => {
    const entry = odometerEntry(new Date(2026, 2, 1, 9, 0, 0), 467910);
    const rates = [null, 0, -1000, NaN, Infinity, 0.0001, 1, 40, 5000];
    const moments = [
      new Date(2026, 1, 1, 12, 0, 0), // before the reading
      new Date(2026, 2, 1, 0, 0, 0), // same day
      new Date(2026, 2, 8, 12, 0, 0), // a week later
      new Date(2027, 2, 8, 12, 0, 0), // a year later
    ];

    for (const rate of rates) {
      for (const now of moments) {
        const r = computeEstimatedOdometer(entry, rate, now);
        expect(r.estimatedKm).not.toBeNull();
        expect(r.estimatedKm as number).toBeGreaterThanOrEqual(467910);
        expect(r.elapsedDays).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps extrapolating without any staleness cap', () => {
    const entry = odometerEntry(new Date(2026, 2, 1, 9, 0, 0), 467910);
    // 365 calendar days later (2026 and early 2027 are non-leap)
    const r = computeEstimatedOdometer(entry, 40, new Date(2027, 2, 1, 12, 0, 0));

    expect(r.elapsedDays).toBe(365);
    expect(r.estimatedKm).toBe(467910 + 365 * 40);
    expect(r.isEstimated).toBe(true);
  });
});
