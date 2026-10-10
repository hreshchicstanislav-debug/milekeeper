import type { OdometerEntry, ServiceItem, ServiceEvent } from '@/lib/db/types';

export type GettingStartedStep =
  | { kind: 'odometer' }
  | { kind: 'item' }
  | { kind: 'replacement'; item: Pick<ServiceItem, 'id' | 'title'> }
  | { kind: 'history' };

/** UI guidance only; use the existing calculation result, never infer pace by row count. */
export function getGettingStartedStep({
  loaded, maxMileageEntry, odometerEntries, serviceItems, lastEventsMap, dailyRate,
}: {
  loaded: boolean;
  maxMileageEntry: OdometerEntry | null;
  odometerEntries: OdometerEntry[];
  serviceItems: ServiceItem[];
  lastEventsMap: Record<string, ServiceEvent | null>;
  dailyRate: number | null;
}): GettingStartedStep | null {
  // An error, guest fallback, or inconsistent independent reads is not an empty account.
  if (!loaded || (maxMileageEntry === null) !== (odometerEntries.length === 0)) return null;
  if (serviceItems.some(item => !Object.hasOwn(lastEventsMap, item.id))) return null;
  if (!maxMileageEntry) return { kind: 'odometer' };
  if (serviceItems.length === 0) return { kind: 'item' };
  const missingReplacement = serviceItems.find(item => lastEventsMap[item.id] === null);
  if (missingReplacement) return { kind: 'replacement', item: missingReplacement };
  if (dailyRate === null || !Number.isFinite(dailyRate) || dailyRate <= 0) return { kind: 'history' };
  return null;
}
