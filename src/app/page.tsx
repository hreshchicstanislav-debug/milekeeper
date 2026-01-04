import { getMaxMileageEntry, listOdometerEntries } from '@/lib/actions/odometerActions';
import { listServiceItems, listLastServiceEventsForItems } from '@/lib/actions/serviceActions';
import { computeDailyRate, computeConfidence } from '@/lib/prediction/dailyRate';
import { estimateDailyKmRate } from '@/lib/service/odometerForecast';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';
import { pickSoonMaintenanceItems, DEFAULT_THRESHOLDS, type SoonMaintenanceItemInput } from '@/lib/home/soonMaintenance';
import AddMileageForm from './components/AddMileageForm';
import HomeAdaptiveContent from './components/HomeAdaptiveContent';
import HomeSoonMaintenanceBlock from './components/HomeSoonMaintenanceBlock';
import HomeContentClient from './components/HomeContentClient';
import { time } from '@/lib/dev/timing';
import { startRequestScope, formatProfilerSummary } from '@/lib/dev/dbProfiler';
import Link from 'next/link';
import { RU, formatNumber } from '@/lib/copy/ru';
import { formatDateTimeRu } from '@/lib/ui/formatDateTimeRu';

// Force dynamic rendering to ensure fresh data on every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UrgencyStatus = 'OVERDUE' | 'SOON' | 'OK';

interface ServiceItemWithStatus {
  item: Awaited<ReturnType<typeof listServiceItems>>[0];
  lastEvent: Awaited<ReturnType<typeof listLastServiceEventsForItems>>[string];
  remainingKm: number | null;
  remainingDays: number | null; // Semantic: calendar for 'calendar' mode, predicted for 'km' mode
  urgency: UrgencyStatus;
  deadlineDate: Date | null;
  statusResult?: ReturnType<typeof calcServiceStatus>; // For debugging
}

export default async function Home() {
  // Start DB profiler scope (dev-only)
  const profiler = startRequestScope('home');
  
  // Total timing for all data loading (dev-only)
  const totalStart = process.env.NODE_ENV !== 'production' ? performance.now() : 0;

  // Phase 1: Load independent data in parallel (all start simultaneously)
  // Create promises first (they start executing immediately)
  const maxMileageEntryP = time('home:load-odometer-max', () => 
    profiler.wrap('odometer:getMaxMileage', () => getMaxMileageEntry())
  );
  const odometerEntriesP = time('home:load-odometer-entries', () => 
    profiler.wrap('odometer:list(50)', () => listOdometerEntries(50))
  );
  const serviceItemsP = time('home:load-items', () => 
    profiler.wrap('service:items:list', () => listServiceItems())
  );

  // Await all parallel requests (no sequential waits)
  const [maxMileageEntry, odometerEntries, serviceItems] = await Promise.all([
    maxMileageEntryP,
    odometerEntriesP,
    serviceItemsP,
  ]);

  // Phase 2: Load dependent data (requires serviceItems from phase 1)
  const lastEventsMap = await time('home:load-events', async () => {
    if (serviceItems.length === 0) {
      return {};
    }
    return profiler.wrap('service:events:lastForItems', () => 
      listLastServiceEventsForItems(serviceItems.map(item => item.id))
    );
  });

  // Log total timing and DB profiler summary (dev-only)
  if (process.env.NODE_ENV !== 'production') {
    const totalMs = performance.now() - totalStart;
    console.log(`Server  home:total: ${totalMs.toFixed(2)}ms`);
    const summary = profiler.summary();
    console.log(formatProfilerSummary(summary));
  }

  // Use max mileage entry for "current mileage" display (matches validation logic)
  const currentMileage = maxMileageEntry?.mileage_km ?? null;
  const now = new Date();

  // Compute daily rate and confidence from odometer entries
  const dailyRate = computeDailyRate(odometerEntries);
  const confidence = computeConfidence(odometerEntries);
  
  // Compute forecast daily km rate for km-mode items (using simpler estimateDailyKmRate)
  // Returns EstimateResult with dailyKmRate (always > 0) and isFallback flag
  const forecastResult = estimateDailyKmRate(odometerEntries);
  const forecastDailyKmRate = forecastResult.dailyKmRate; // Always > 0 (fallback if needed)
  const isFallbackRate = forecastResult.isFallback; // True if using fallback (30 km/day)
  
  // Dev-only: ensure dailyKmRate is a number
  if (process.env.NODE_ENV !== 'production') {
    if (typeof forecastDailyKmRate !== 'number' || forecastDailyKmRate <= 0) {
      console.warn('[Home] Invalid dailyKmRate:', { forecastDailyKmRate, forecastResult, odometerEntriesCount: odometerEntries.length });
    }
  }

  // Compute status for each service item using new helper
  const itemsWithStatus: ServiceItemWithStatus[] = serviceItems.map((item) => {
    const lastEvent = lastEventsMap[item.id] ?? null;
    
    // Use new calcServiceStatus helper with dailyKmRate for forecasting
    const statusResult = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: currentMileage,
      lastEvent,
      dailyKmRate: forecastDailyKmRate,
      now,
    });

    // Map to existing interface (for compatibility)
    // Use remainingDays and remainingKm directly from statusResult (already computed based on measurement_mode)
    const remainingKm = statusResult.remainingKm;
    const remainingDays = statusResult.remainingDays; // Already semantic: calendar for 'calendar' mode, predicted for 'km' mode
    
    // Determine deadlineDate for sorting (if needed)
    let deadlineDate: Date | null = null;
    if (statusResult.status !== 'UNKNOWN') {
      if (statusResult.primary.kind === 'km') {
        // For km mode, predict date if dailyRate is available
        if (dailyRate !== null && dailyRate > 0 && remainingKm !== null && remainingKm > 0) {
          const predictedDays = Math.ceil(remainingKm / dailyRate);
          const predictedDate = new Date(now);
          predictedDate.setDate(predictedDate.getDate() + predictedDays);
          deadlineDate = predictedDate;
        }
        // Fallback to secondary due date if available
        if (deadlineDate === null && statusResult.secondary && statusResult.secondary.dueValue !== null) {
          deadlineDate = new Date(statusResult.secondary.dueValue);
        }
      } else {
        // Primary is time-based (calendar mode)
        deadlineDate = new Date(statusResult.primary.dueValue);
      }
    }

    // Map status
    const urgency: UrgencyStatus = statusResult.status === 'UNKNOWN' ? 'OK' : statusResult.status;

    // Dev-only: compare old vs new logic (temporary, only for first item)
    if (process.env.NODE_ENV !== 'production' && serviceItems.indexOf(item) === 0 && lastEvent && currentMileage !== null) {
      const lastServiceMileage = lastEvent.mileage_km;
      const lastServiceDate = new Date(lastEvent.occurred_at);
      
      let oldRemainingKm: number | null = null;
      let oldRemainingDays: number | null = null;
      let oldUrgency: UrgencyStatus = 'OK';
      
      if (item.interval_km !== null) {
        oldRemainingKm = lastServiceMileage + item.interval_km - currentMileage;
      }
      if (item.interval_days !== null) {
        const dueDate = new Date(lastServiceDate);
        dueDate.setDate(dueDate.getDate() + item.interval_days);
        oldRemainingDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      if (oldRemainingKm !== null && oldRemainingKm <= 0) {
        oldUrgency = 'OVERDUE';
      } else if (oldRemainingDays !== null && oldRemainingDays <= 0) {
        oldUrgency = 'OVERDUE';
      } else if (oldRemainingKm !== null && item.notify_before_km !== null && oldRemainingKm <= item.notify_before_km) {
        oldUrgency = 'SOON';
      } else if (oldRemainingDays !== null && oldRemainingDays <= item.notify_before_days) {
        oldUrgency = 'SOON';
      }
      
      console.log(`[Home] ${item.title}:`, {
        old: { urgency: oldUrgency, remainingKm: oldRemainingKm, remainingDays: oldRemainingDays },
        new: { 
          status: statusResult.status, 
          limitingFactor: statusResult.limitingFactor,
          primaryRemaining: statusResult.primary.remainingValue,
        },
      });
    }

    return {
      item,
      lastEvent,
      remainingKm,
      remainingDays, // Semantic: calendar for 'calendar' mode, predicted for 'km' mode
      urgency,
      deadlineDate,
      statusResult, // Keep statusResult for debugging (always present)
    };
  });

  // Dev-only: debug forecast days pipeline for specific items
  if (process.env.NODE_ENV !== 'production') {
    const debugItems = itemsWithStatus.filter(({ item }) => 
      item.title === 'Масло двигателя' || item.title === 'Масляный фильтр'
    );
    
    if (debugItems.length > 0) {
      console.log('[Home] Forecast days debug:', {
        dailyKmRate: forecastDailyKmRate,
        dailyKmRateType: typeof forecastDailyKmRate,
        isFallback: forecastResult.isFallback,
        odometerEntriesCount: odometerEntries.length,
        currentMileage,
        items: debugItems.map(({ item, remainingKm, remainingDays, urgency, lastEvent, statusResult }) => ({
          title: item.title,
          measurement_mode: item.measurement_mode,
          interval_km: item.interval_km,
          notify_before_km: item.notify_before_km,
          lastEvent: lastEvent ? {
            mileage_km: lastEvent.mileage_km,
            occurred_at: lastEvent.occurred_at,
          } : null,
          remainingKm,
          remainingDays,
          urgency,
          predictedDaysFromKm: statusResult?.predictedDaysFromKm ?? null,
          dailyKmRateUsed: statusResult?.dailyKmRateUsed ?? null,
        })),
      });
    }
  }

  // Sort items: OVERDUE first, then by deadlineDate, then by remainingKm, then by title
  // Items without last events are sorted last
  itemsWithStatus.sort((a, b) => {
    // Items without last events go to the end
    if (!a.lastEvent && b.lastEvent) return 1;
    if (a.lastEvent && !b.lastEvent) return -1;
    if (!a.lastEvent && !b.lastEvent) {
      return a.item.title.localeCompare(b.item.title);
    }

    // 1. OVERDUE first
    if (a.urgency === 'OVERDUE' && b.urgency !== 'OVERDUE') return -1;
    if (a.urgency !== 'OVERDUE' && b.urgency === 'OVERDUE') return 1;
    
    // Within OVERDUE, sort by most overdue (prioritize days, then km)
    if (a.urgency === 'OVERDUE' && b.urgency === 'OVERDUE') {
      // Compare by remainingDays first (if both available)
      if (a.remainingDays !== null && b.remainingDays !== null) {
        if (a.remainingDays !== b.remainingDays) return a.remainingDays - b.remainingDays;
      } else if (a.remainingDays !== null) return -1;
      else if (b.remainingDays !== null) return 1;
      // Fallback to remainingKm
      if (a.remainingKm !== null && b.remainingKm !== null) {
        if (a.remainingKm !== b.remainingKm) return a.remainingKm - b.remainingKm;
      }
    }

    // 2. By earliest deadlineDate
    if (a.deadlineDate && b.deadlineDate) {
      const dateDiff = a.deadlineDate.getTime() - b.deadlineDate.getTime();
      if (dateDiff !== 0) return dateDiff;
    } else if (a.deadlineDate) return -1;
    else if (b.deadlineDate) return 1;

    // 3. By smallest remainingKm
    if (a.remainingKm !== null && b.remainingKm !== null) {
      if (a.remainingKm !== b.remainingKm) return a.remainingKm - b.remainingKm;
    } else if (a.remainingKm !== null) return -1;
    else if (b.remainingKm !== null) return 1;

    // 4. By title
    return a.item.title.localeCompare(b.item.title);
  });

  // Filter items eligible for Home upcoming dashboard:
  // - Must have lastEvent (baseline replacement)
  // - Must be OVERDUE or SOON (using statusResult.status as single source of truth)
  const urgentItemsForHome = itemsWithStatus
    .filter(({ item, lastEvent, statusResult }) => {
      // Exclude items without lastEvent
      if (!lastEvent) return false;
      
      // Include only OVERDUE or SOON items (using statusResult.status)
      if (!statusResult) return false;
      return statusResult.status === 'OVERDUE' || statusResult.status === 'SOON';
    })
    .map(({ item, lastEvent, statusResult }) => ({
      item,
      lastEvent,
      statusResult: statusResult!,
    }));

  // Compute soon maintenance items using helper module
  const soonMaintenanceInputs: SoonMaintenanceItemInput[] = itemsWithStatus
    .filter(({ lastEvent, statusResult }) => {
      // Only include items with lastEvent and statusResult
      return !!lastEvent && !!statusResult;
    })
    .map(({ item, statusResult }) => {
      // statusResult is guaranteed to exist due to filter above
      const status = statusResult!;
      const isOverdue = status.status === 'OVERDUE';
      return {
        id: item.id,
        title: item.title,
        mode: item.measurement_mode === 'km' ? 'km' : 'calendar',
        status: status.status === 'UNKNOWN' ? 'OK' : status.status,
        remainingKm: status.remainingKm,
        remainingDays: status.remainingDays,
        isOverdue,
        notifyBeforeDays: item.notify_before_days,
      };
    });

  const soonMaintenanceItems = pickSoonMaintenanceItems(soonMaintenanceInputs, DEFAULT_THRESHOLDS);

  // Dev-only: Diagnostic log for km-mode items
  if (process.env.NODE_ENV !== 'production') {
    const kmItems = itemsWithStatus.filter(({ item, lastEvent, statusResult }) => 
      item.measurement_mode === 'km' && lastEvent && statusResult
    );
    
    if (kmItems.length > 0) {
      kmItems.forEach(({ item, statusResult }) => {
        const status = statusResult!;
        const isIncluded = soonMaintenanceItems.some(listItem => listItem.id === item.id);
        const dailyKmRateUsed = status.dailyKmRateUsed ?? forecastDailyKmRate;
        // dailyKmRateUsed is set to 30 when fallback is used in calcServiceStatus
        const isFallback = dailyKmRateUsed === 30 && isFallbackRate;
        
        console.log(
          `[Home KM] ${item.title} | ` +
          `remainingKm=${status.remainingKm?.toFixed(0) ?? 'null'} | ` +
          `remainingDays=${status.remainingDays?.toFixed(1) ?? 'null'} | ` +
          `notify=${item.notify_before_days} | ` +
          `rate=${dailyKmRateUsed.toFixed(1)}${isFallback ? '(fallback)' : ''} | ` +
          `included=${isIncluded}`
        );
      });
    }
  }

  // Dev-only: TEMP diagnostic log for 2 items (масло двигателя / масляный фильтр)
  // Logs EXACT values used in UI calculation
  if (process.env.NODE_ENV !== 'production') {
    const debugItems = itemsWithStatus.filter(({ item }) => 
      item.title === 'Масло двигателя' || item.title === 'Масляный фильтр'
    );
    if (debugItems.length > 0) {
      debugItems.forEach(({ item, lastEvent, statusResult }) => {
        if (statusResult && lastEvent) {
          const lastMileage = lastEvent.mileage_km;
          const intervalKm = item.interval_km;
          const dueMileageKm = intervalKm !== null ? lastMileage + intervalKm : null;
          const remainingKmCalc = dueMileageKm !== null && currentMileage !== null 
            ? dueMileageKm - currentMileage 
            : null;
          const dailyKmRateUsed = statusResult.dailyKmRateUsed ?? 30;
          const predictedDaysCalc = remainingKmCalc !== null 
            ? remainingKmCalc / dailyKmRateUsed 
            : null;
          
          console.log(`[Home DIAG] ${item.title}:`, {
            currentMileage,
            lastEvent_mileage: lastMileage,
            lastEvent_occurred_at: lastEvent.occurred_at,
            interval_km: intervalKm,
            dueMileageKm,
            remainingKm_calculated: remainingKmCalc,
            remainingKm_fromResult: statusResult.remainingKm,
            dailyKmRateUsed,
            predictedDays_calculated: predictedDaysCalc,
            remainingDays_fromResult: statusResult.remainingDays,
            predictedDaysFromKm: statusResult.predictedDaysFromKm,
            notify_before_days: item.notify_before_days,
            status: statusResult.status,
            urgency: itemsWithStatus.find(i => i.item.id === item.id)?.urgency,
          });
        }
      });
    }
  }

  return (
    <>
      <header className="page-header">
        <h1>{RU.home.title}</h1>
      </header>
      <HomeContentClient>
        <div className="mileage-card">
          <div className="mileage-label">{RU.home.currentMileage}</div>
          <div className="mileage-value">
            {maxMileageEntry
              ? `${formatNumber(maxMileageEntry.mileage_km)} ${RU.common.km}`
              : RU.home.noEntriesYet}
          </div>
          {maxMileageEntry && (
            <div className="mileage-date">
              {formatDateTimeRu(maxMileageEntry.occurred_at)}
            </div>
          )}
        </div>

        <div className="add-mileage-section">
          <AddMileageForm />
        </div>

        {/* Soon Maintenance Block - Conditional */}
        <HomeSoonMaintenanceBlock 
          items={soonMaintenanceItems} 
          dailyKmRate={forecastDailyKmRate}
          isFallbackRate={isFallbackRate}
        />

        {/* Upcoming Replacements Section - Adaptive Dashboard */}
        <HomeAdaptiveContent
          urgentItems={urgentItemsForHome}
          odometerEntriesLength={odometerEntries.length}
          confidence={confidence}
          predictionHintText={RU.home.predictionHint[confidence]}
        />
      </HomeContentClient>
    </>
  );
}
