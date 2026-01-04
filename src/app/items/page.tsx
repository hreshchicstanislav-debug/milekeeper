import { listServiceItems, listLastServiceEventsForItems, listLastServiceEventsByMaxMileage } from '@/lib/actions/serviceActions';
import { getMaxMileageEntry, listOdometerEntries } from '@/lib/actions/odometerActions';
import { calcServiceStatus, compareServiceUrgency } from '@/lib/service/calcServiceStatus';
import { estimateDailyKmRate } from '@/lib/service/odometerForecast';
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
    profiler.wrap('odometer:getMaxMileage', () => getMaxMileageEntry())
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
  
  // FIX: For 'km' mode items, get events with maximum mileage instead of latest date
  const kmModeItemIds = items
    .filter(item => item.measurement_mode === 'km')
    .map(item => item.id);
  
  const kmModeEventsByMaxMileage = kmModeItemIds.length > 0
    ? await listLastServiceEventsByMaxMileage(kmModeItemIds)
    : {};
  
  // Сопоставляем элементы с их последними событиями и вычисляем статус для сортировки
  const currentMileage = latestOdometer?.mileage_km ?? null;
  const now = new Date();
  
  // Compute forecast daily km rate for km-mode items
  // Returns EstimateResult with dailyKmRate (always > 0) and isFallback flag
  const forecastResult = estimateDailyKmRate(odometerEntries);
  const forecastDailyKmRate = forecastResult.dailyKmRate; // Always > 0 (fallback if needed)

  const itemsWithStatus = items.map((item) => {
    // For km-mode, use event with max mileage; for calendar-mode, use date-based (from lastEventsMap)
    const lastEvent = item.measurement_mode === 'km' 
      ? (kmModeEventsByMaxMileage[item.id] ?? null)
      : (lastEventsMap[item.id] ?? null);
    const statusResult = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: currentMileage,
      lastEvent,
      dailyKmRate: forecastDailyKmRate,
      now,
    });
    return {
      item,
      lastEvent,
      statusResult,
    };
  });

  // Сортируем по срочности: OVERDUE наверху, затем SOON, затем OK, затем UNKNOWN
  // Внутри каждой группы: по степени просрочки/остатку (чем хуже, тем выше)
  itemsWithStatus.sort(compareServiceUrgency);

  // Log DB profiler summary (dev-only)
  if (process.env.NODE_ENV !== 'production') {
    const summary = profiler.summary();
    console.log(formatProfilerSummary(summary));
  }

  // Преобразуем обратно в формат, ожидаемый клиентом (без statusResult)
  const itemsWithLastEvent = itemsWithStatus.map(({ item, lastEvent }) => ({
    item,
    lastEvent,
  }));

  return <ItemsPageClient itemsWithLastEvent={itemsWithLastEvent} latestOdometer={latestOdometer} dailyKmRate={forecastDailyKmRate} />;
}
