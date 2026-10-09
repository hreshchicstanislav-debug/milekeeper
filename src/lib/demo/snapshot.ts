import type { OdometerEntry, ServiceEvent, ServiceItem } from '@/lib/db/types';
import { calculateDailyMileageRateToBe, toLocalDayKey } from '@/lib/service/dailyMileageRateToBe';
import { computeEstimatedOdometer } from '@/lib/service/estimatedOdometer';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';
import { buildServiceItemStatusVM } from '@/lib/service/serviceItemStatusVM';
import { sortByUrgency } from '@/lib/service/serviceItemUrgencySort';
import { pickSoonMaintenanceItems } from '@/lib/home/soonMaintenance';

/** Frozen example, evaluated only on the server. No AppNow, session or storage. */
export const DEMO_DAY = '2026-10-09';
export function createDemoSnapshot() {
  // The existing engine works with local calendar days. Construct every fixture
  // at local noon in the SAME execution zone; only derived numbers reach clients.
  const [year, month, day] = DEMO_DAY.split('-').map(Number);
  const now = new Date(year, month - 1, day, 12);
  const at = (offset: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    return date.toISOString();
  };
  const user_id = 'fictional-local-only';
  const readings: OdometerEntry[] = [[-56, 120000], [-49, 120280], [-42, 120560], [-28, 121120], [-14, 121680], [-7, 121960], [-2, 122200]].map(([offset, mileage_km], index) => ({
    id: `reading-${index}`, user_id, occurred_at: at(offset), mileage_km, note: null, created_at: at(offset),
  }));
  const configurations = [
    { id: 'oil', km: 10000, days: null, offset: -180, mileage: 113000 },
    { id: 'cabin', km: 10000, days: null, offset: -240, mileage: 112000 },
    { id: 'air', km: 15000, days: null, offset: -150, mileage: 114000 },
    { id: 'brake', km: null, days: 730, offset: -720, mileage: 100000 },
    { id: 'wipers', km: null, days: 365, offset: null, mileage: null },
  ] as const;
  const rate = calculateDailyMileageRateToBe(readings, now);
  const odometer = computeEstimatedOdometer(readings[readings.length - 1], rate.dailyRate, now);
  const items = configurations.map(config => {
    const item: ServiceItem = {
      id: config.id, user_id, title: config.id, interval_km: config.km, interval_days: config.days,
      measurement_mode: config.km === null ? 'calendar' : 'km', notify_before_days: 30,
      notify_before_km: null, is_active: true, note: null, created_at: at(-350),
    };
    const events: ServiceEvent[] = config.offset === null ? [] : [{
      id: `event-${config.id}`, user_id, service_item_id: config.id,
      occurred_at: at(config.offset), mileage_km: config.mileage!, created_at: at(config.offset), note: null,
    }];
    if (config.id === 'oil') events.push({ id: 'older-oil', user_id, service_item_id: config.id, occurred_at: at(-350), mileage_km: 103000, created_at: at(-350), note: null });
    const lastEvent = [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0] ?? null;
    const status = calcServiceStatus({ serviceItem: item, lastEvent, latestOdometerMileageKm: odometer.estimatedKm, dailyKmRate: rate.dailyRate, now });
    const vm = buildServiceItemStatusVM(item, status, { ...item, dailyKmRate: rate.dailyRate });
    return { id: config.id, mode: item.measurement_mode, status, vm };
  });
  const sorted = sortByUrgency(items, row => ({ status: row.status.status, daysToReplace: row.vm.daysToReplace, isPredictionReliable: row.vm.isPredictionReliable, titleOrId: row.id }));
  const soon = pickSoonMaintenanceItems(items.filter(row => row.status.status !== 'UNKNOWN').map(row => ({
    id: row.id, title: row.id, mode: row.mode, status: row.status.status as 'OK' | 'SOON' | 'OVERDUE',
    remainingKm: row.status.remainingKm, remainingDays: row.status.remainingDays,
    isOverdue: row.status.status === 'OVERDUE', notifyBeforeDays: 30,
  })));
  return { day: toLocalDayKey(now), measuredDay: toLocalDayKey(new Date(readings[readings.length - 1].occurred_at)), odometer, rate, items: sorted, soon };
}
export type DemoSnapshot = ReturnType<typeof createDemoSnapshot>;
