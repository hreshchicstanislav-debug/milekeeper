import { describe, expect, it } from 'vitest';
import { getGettingStartedStep } from '../gettingStarted';
import { calculateDailyMileageRateToBe } from '@/lib/service/dailyMileageRateToBe';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';
import type { OdometerEntry, ServiceItem, ServiceEvent } from '@/lib/db/types';
const now = new Date('2026-10-11T12:00:00Z');
const reading = (date: string, mileage = 120000): OdometerEntry => ({ id: date, user_id: 'test', occurred_at: date, mileage_km: mileage, note: null, created_at: date });
const item: ServiceItem = { id: 'oil', user_id: 'test', title: 'My own title', measurement_mode: 'km', interval_km: 10000, interval_days: null, notify_before_days: 30, notify_before_km: null, is_active: true, note: null, created_at: now.toISOString() };
const event: ServiceEvent = { id: 'replacement', user_id: 'test', service_item_id: item.id, occurred_at: '2026-10-01T12:00:00Z', mileage_km: 115000, note: null, created_at: now.toISOString() };
const empty = { loaded: true, maxMileageEntry: null, odometerEntries: [], serviceItems: [], lastEventsMap: {}, dailyRate: null };
const withReading = { ...empty, maxMileageEntry: reading(now.toISOString()), odometerEntries: [reading(now.toISOString())] };
const withItem = { ...withReading, serviceItems: [item], lastEventsMap: { oil: null } };
const withReplacement = { ...withItem, lastEventsMap: { oil: event } };

describe('one next step based on successfully loaded own data', () => {
  it('starts with odometer for empty data', () => expect(getGettingStartedStep(empty)).toEqual({ kind: 'odometer' }));
  it('prioritizes missing odometer even when items exist', () => expect(getGettingStartedStep({ ...withItem, maxMileageEntry: null, odometerEntries: [] })).toEqual({ kind: 'odometer' }));
  it.each([null, 45])('asks for an item regardless of pace %s', dailyRate => expect(getGettingStartedStep({ ...withReading, dailyRate })).toEqual({ kind: 'item' }));
  it('asks for the known baseline, preserving the personal title', () => expect(getGettingStartedStep(withItem)).toEqual({ kind: 'replacement', item }));
  it('handles partially configured mixed items', () => {
    const second = { ...item, id: 'brakes', measurement_mode: 'calendar' as const, interval_days: 365, interval_km: null };
    expect(getGettingStartedStep({ ...withReplacement, dailyRate: 40, serviceItems: [item, second], lastEventsMap: { oil: event, brakes: null } })).toEqual({ kind: 'replacement', item: second });
  });
  it.each([null, 0, NaN, Infinity])('explains real history when pace is unavailable (%s)', dailyRate => expect(getGettingStartedStep({ ...withReplacement, dailyRate })).toEqual({ kind: 'history' }));
  it('does not gate calendar calculations on pace', () => {
    const calendar = { ...item, measurement_mode: 'calendar' as const, interval_km: null, interval_days: 365 };
    expect(getGettingStartedStep({ ...withReplacement, serviceItems: [calendar] })?.kind).toBe('history');
    const result = calcServiceStatus({ serviceItem: calendar, lastEvent: event, latestOdometerMileageKm: 120000, dailyKmRate: null, now });
    expect(result.remainingDays).toBeGreaterThan(0);
    expect(result.status).not.toBe('UNKNOWN');
  });
  it.each([
    [reading('2026-10-11T08:00:00Z'), reading('2026-10-11T07:00:00Z', 119900)],
    [reading('2026-10-11T08:00:00Z'), reading('2026-10-10T08:00:00Z')],
    [reading('2026-10-12T08:00:00Z', 120100), reading('2026-10-11T08:00:00Z')],
  ])('uses the real calculator for same-day, unchanged and future history', (...entries) => {
    const dailyRate = calculateDailyMileageRateToBe(entries, now).dailyRate;
    expect(dailyRate).toBeNull();
    expect(getGettingStartedStep({ ...withReplacement, odometerEntries: entries, dailyRate })?.kind).toBe('history');
  });
  it.each([
    [reading('2026-10-11T08:00:00Z'), reading('2026-10-10T08:00:00Z', 119900)],
    [reading('2026-01-11T08:00:00Z'), reading('2026-01-10T08:00:00Z', 119900)],
  ])('hides onboarding with positive pace including old-history fallback', (...entries) => {
    const dailyRate = calculateDailyMileageRateToBe(entries, now).dailyRate;
    expect(dailyRate).toBeGreaterThan(0);
    expect(getGettingStartedStep({ ...withReplacement, odometerEntries: entries, dailyRate })).toBeNull();
  });
  it('never treats an unloaded/error/guest fallback as empty', () => expect(getGettingStartedStep({ ...empty, loaded: false })).toBeNull());
  it('does not infer missing events from an incomplete map', () => expect(getGettingStartedStep({ ...withItem, lastEventsMap: {} })).toBeNull());
  it.each([
    { ...withReading, maxMileageEntry: null },
    { ...withReading, odometerEntries: [] },
  ])('suppresses inconsistent independent reads', input => expect(getGettingStartedStep(input)).toBeNull());
});
