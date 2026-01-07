import { listServiceItems, listLastServiceEventsForItems } from '@/lib/actions/serviceActions';
import { getMaxMileageEntry, listOdometerEntries } from '@/lib/actions/odometerActions';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';
import { estimateDailyKmRate } from '@/lib/service/odometerForecast';
import { buildServiceItemStatusVM, type ServiceItemStatusVM } from '@/lib/service/serviceItemStatusVM';
import { sortByUrgency } from '@/lib/service/serviceItemUrgencySort';
import ItemsPageClient from './ItemsPageClient';
import { time } from '@/lib/dev/timing';
import { startRequestScope, formatProfilerSummary } from '@/lib/dev/dbProfiler';

// Force dynamic rendering to ensure fresh data on every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ItemsPage() {
  // Start DB profiler scope (dev-only)
  const profiler = startRequestScope('items');
  
  // Load independent data in parallel (with timing)
  const itemsP = time('items:load-items', () => 
    profiler.wrap('service:items:list', () => listServiceItems())
  );
  const latestOdometerP = time('items:load-odometer', () => 
    profiler.wrap('odometer:getMaxMileage', () => getMaxMileageEntry('ItemsList'))
  );
  const odometerEntriesP = time('items:load-odometer-entries', () => 
    profiler.wrap('odometer:list(50)', () => listOdometerEntries(50))
  );

  // Await all parallel requests
  const [items, latestOdometer, odometerEntries] = await Promise.all([itemsP, latestOdometerP, odometerEntriesP]);
  
  // Получаем последние события обслуживания для всех элементов одним запросом
  const lastEventsMap = await time('items:load-events', async () => {
    if (items.length === 0) {
      return {};
    }
    return profiler.wrap('service:events:lastForItems', () => 
      listLastServiceEventsForItems(items.map(item => item.id))
    );
  });
  
  // Сопоставляем элементы с их последними событиями и вычисляем статус для сортировки
  const currentMileage = latestOdometer?.mileage_km ?? null;
  const now = new Date();
  
  // Compute forecast daily km rate for km-mode items
  // Returns EstimateResult with dailyKmRate (always > 0) and isFallback flag
  const forecastResult = estimateDailyKmRate(odometerEntries);
  const forecastDailyKmRate = forecastResult.dailyKmRate; // Always > 0 (fallback if needed)
  const isFallbackRate = forecastResult.isFallback; // True if using fallback (30 km/day)

  const itemsWithStatus = items.map((item) => {
    const lastEvent = lastEventsMap[item.id] || null;
    const statusResult = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: currentMileage,
      lastEvent,
      dailyKmRate: forecastDailyKmRate,
      now,
    });
    
    // Build view-model for Target UI (v1) - see docs/elements-status-ui-v1.md
    // Note: confidence is not computed in Items List, so it's undefined
    const statusVM = buildServiceItemStatusVM(item, statusResult, {
      measurement_mode: item.measurement_mode,
      interval_km: item.interval_km,
      interval_days: item.interval_days,
      notify_before_days: item.notify_before_days,
      dailyKmRate: forecastDailyKmRate,
      isFallbackRate: isFallbackRate,
      confidence: undefined, // Not computed in Items List
    });
    
    return {
      item,
      lastEvent,
      statusResult,
      statusVM, // View-model for new UI (not used in current UI)
    };
  });

  // Сортируем по срочности согласно спецификации (sections 9-14)
  // Используем statusVM для получения метаданных для сортировки
  const itemsWithStatusSorted = sortByUrgency(itemsWithStatus, (item) => {
    const status = item.statusResult?.status ?? 'UNKNOWN';
    return {
      status,
      daysToReplace: item.statusVM?.daysToReplace ?? null,
      isPredictionReliable: item.statusVM?.isPredictionReliable ?? false,
      titleOrId: item.item.title,
    };
  });

  // Преобразуем в формат, ожидаемый клиентом (с statusVM для нового UI)
  const itemsWithLastEvent = itemsWithStatusSorted.map(({ item, lastEvent, statusVM }) => ({
    item,
    lastEvent,
    statusVM, // View-model for Target UI (v1)
  }));

  // Log DB profiler summary (dev-only)
  if (process.env.NODE_ENV !== 'production') {
    const summary = profiler.summary();
    console.log(formatProfilerSummary(summary));
  }

  return <ItemsPageClient itemsWithLastEvent={itemsWithLastEvent} latestOdometer={latestOdometer} dailyKmRate={forecastDailyKmRate} />;
}
