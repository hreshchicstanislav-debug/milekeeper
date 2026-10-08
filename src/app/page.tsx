import { getCopy } from '@/lib/i18n/server';
import { getMaxMileageEntry, listOdometerEntries } from '@/lib/actions/odometerActions';
import { listServiceItems, listLastServiceEventsForItems } from '@/lib/actions/serviceActions';
import { computeConfidence } from '@/lib/prediction/dailyRate';
import { calculateDailyMileageRateToBe } from '@/lib/service/dailyMileageRateToBe';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';
import { computeEstimatedOdometer } from '@/lib/service/estimatedOdometer';
import { pickSoonMaintenanceItems, DEFAULT_THRESHOLDS, type SoonMaintenanceItemInput } from '@/lib/home/soonMaintenance';
import { buildServiceItemStatusVM, type ServiceItemStatusVM } from '@/lib/service/serviceItemStatusVM';
import { sortByUrgency } from '@/lib/service/serviceItemUrgencySort';
import { getAppNow } from '@/lib/appNow';
import { getAppMode } from '@/lib/appMode';
import AddMileageForm from './components/AddMileageForm';
import HomeAdaptiveContent from './components/HomeAdaptiveContent';
import HomeSoonMaintenanceBlock from './components/HomeSoonMaintenanceBlock';
import HomeContentClient from './components/HomeContentClient';
import { time } from '@/lib/dev/timing';
import { startRequestScope, formatProfilerSummary } from '@/lib/dev/dbProfiler';
import Link from 'next/link';
import { LocalDateTime } from '@/app/components/LocalDateTime';

// Force dynamic rendering to ensure fresh data on every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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

let hasLoggedDevGuestMode = false;

function isDevGuestEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_GUEST_MODE === '1';
}

function isNotAuthenticatedReason(reason: unknown) {
  return reason === 'Not authenticated' || (reason instanceof Error && reason.message === 'Not authenticated');
}

function toError(reason: unknown) {
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === 'string') {
    return new Error(reason);
  }
  return new Error('Unknown error');
}

function logDevGuestModeOnce() {
  if (process.env.NODE_ENV === 'production' || hasLoggedDevGuestMode) {
    return;
  }
  hasLoggedDevGuestMode = true;
  const rawValue = process.env.NEXT_PUBLIC_DEV_GUEST_MODE;
  console.log(
    `[dev-guest] enabled=${isDevGuestEnabled()} NEXT_PUBLIC_DEV_GUEST_MODE=${rawValue ?? '<unset>'}`
  );
}

export default async function Home() {
  const { RU, t, formatNumber } = await getCopy();
  // Start DB profiler scope (dev-only)
  const profiler = startRequestScope('home');
  logDevGuestModeOnce();
  
  // Total timing for all data loading (dev-only)
  const totalStart = process.env.NODE_ENV !== 'production' ? performance.now() : 0;

  const devGuestEnabled = isDevGuestEnabled();
  let maxMileageEntry: Awaited<ReturnType<typeof getMaxMileageEntry>> = null;
  let odometerEntries: Awaited<ReturnType<typeof listOdometerEntries>> = [];
  let serviceItems: Awaited<ReturnType<typeof listServiceItems>> = [];

  // Phase 1: Load independent data in parallel (all start simultaneously)
  const phase1Results = await Promise.allSettled([
    time('home:load-odometer-max', () =>
      profiler.wrap('odometer:getMaxMileage', () => getMaxMileageEntry('Home'))
    ),
    time('home:load-odometer-entries', () =>
      profiler.wrap('odometer:list(50)', () => listOdometerEntries(50))
    ),
    time('home:load-items', () =>
      profiler.wrap('service:items:list', () => listServiceItems())
    ),
  ]);

  const phase1Rejections = phase1Results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );

  if (phase1Rejections.length === 0) {
    const [maxMileageEntryResult, odometerEntriesResult, serviceItemsResult] = phase1Results;
    if (
      maxMileageEntryResult.status === 'fulfilled' &&
      odometerEntriesResult.status === 'fulfilled' &&
      serviceItemsResult.status === 'fulfilled'
    ) {
      maxMileageEntry = maxMileageEntryResult.value;
      odometerEntries = odometerEntriesResult.value;
      serviceItems = serviceItemsResult.value;
    }
  } else if (!devGuestEnabled) {
    throw toError(phase1Rejections[0].reason);
  } else {
    const firstNonAuthRejection = phase1Rejections.find(
      ({ reason }) => !isNotAuthenticatedReason(reason)
    );
    if (firstNonAuthRejection) {
      throw toError(firstNonAuthRejection.reason);
    }
    // Dev-guest mode: all phase-1 failures are auth-related, so continue with empty/null defaults.
  }

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

  // Use canonical AppNow for all time-based calculations (TEST mode uses stored AppNow, LIVE uses real time)
  const appNow = getAppNow();

  // TO-BE: Compute daily mileage rate (rolling 60 days + fallback 14 active days)
  const dailyRateResult = calculateDailyMileageRateToBe(odometerEntries, appNow);
  const dailyRate = dailyRateResult.dailyRate;
  const confidence = computeConfidence(odometerEntries);

  // Estimated current odometer: last actual reading + elapsed calendar days * dailyRate.
  // This (not the raw last reading) is what every forecast below is based on, so that
  // maintenance estimates keep moving with time even without new manual input.
  const estimatedOdometer = computeEstimatedOdometer(maxMileageEntry, dailyRate, appNow);
  const currentMileage = estimatedOdometer.estimatedKm;
  
  // TO-BE: Single dailyRate is used for forecasting everywhere
  const forecastDailyKmRate = dailyRate; // number | null
  const isFallbackRate = dailyRateResult.isFallback;
  const windowDaysUsed = dailyRateResult.isFallback ? null : 60;
  
  // Dev-only: ensure dailyKmRate is a number
  // (Dev logs that assumed numeric dailyKmRate were removed; TO-BE allows insufficient data => null)

  // Compute status for each service item using new helper
  const itemsWithStatus: ServiceItemWithStatus[] = serviceItems.map((item) => {
    const lastEvent = lastEventsMap[item.id] ?? null;
    
    // Use new calcServiceStatus helper with dailyKmRate for forecasting
    // Pass appNow (canonical AppNow) instead of new Date() for time-based calculations
    const statusResult = calcServiceStatus({
      serviceItem: item,
      latestOdometerMileageKm: currentMileage,
      lastEvent,
      dailyKmRate: forecastDailyKmRate,
      now: appNow,
    });

    // Map to existing interface (for compatibility)
    // Use remainingDays and remainingKm directly from statusResult (already computed based on measurement_mode)
    const remainingKm = statusResult.remainingKm;
    const remainingDays = statusResult.remainingDays; // Already semantic: calendar for 'calendar' mode, predicted for 'km' mode
    
    // Determine deadlineDate for sorting (if needed)
    let deadlineDate: Date | null = null;
    if (statusResult.status !== 'UNKNOWN') {
      if (statusResult.primary.kind === 'km') {
        // TO-BE: predict date from km only if dailyRate is available (>0)
        if (dailyRate !== null && dailyRate > 0 && remainingKm !== null && remainingKm > 0) {
          const predictedDays = Math.ceil(remainingKm / dailyRate);
          const predictedDate = new Date(appNow);
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
        oldRemainingDays = Math.ceil((dueDate.getTime() - appNow.getTime()) / (1000 * 60 * 60 * 24));
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
        isFallback: isFallbackRate,
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

  // Build statusVM for each soonMaintenanceItem (for Target UI v1)
  // Map soonMaintenanceItems to their corresponding itemsWithStatus to get full context
  const soonMaintenanceItemsWithVMUnsorted = soonMaintenanceItems.map(soonItem => {
    // Find corresponding item in itemsWithStatus
    const itemWithStatus = itemsWithStatus.find(i => i.item.id === soonItem.id);
    
    if (!itemWithStatus || !itemWithStatus.statusResult) {
      // Fallback: create a minimal statusVM (should not happen in practice)
      return {
        ...soonItem,
        statusVM: null as ServiceItemStatusVM | null,
      };
    }
    
    const { item, statusResult } = itemWithStatus;
    
    // Build view-model for Target UI (v1) - see docs/elements-status-ui-v1.md
    const statusVM = buildServiceItemStatusVM(item, statusResult, {
      measurement_mode: item.measurement_mode,
      interval_km: item.interval_km,
      interval_days: item.interval_days,
      notify_before_days: item.notify_before_days,
      dailyKmRate: forecastDailyKmRate,
      isFallbackRate: isFallbackRate,
      confidence: confidence, // Available from computeConfidence on Home
    });
    
    return {
      ...soonItem,
      statusVM,
    };
  });

  // Sort by urgency according to spec (sections 9-14)
  const soonMaintenanceItemsWithVMSorted = sortByUrgency(soonMaintenanceItemsWithVMUnsorted, (item) => {
    const statusResult = itemsWithStatus.find(i => i.item.id === item.id)?.statusResult;
    const status = statusResult?.status ?? 'UNKNOWN';
    return {
      status,
      daysToReplace: item.statusVM?.daysToReplace ?? null,
      isPredictionReliable: item.statusVM?.isPredictionReliable ?? false,
      titleOrId: item.title,
    };
  });

  // Enforce maximum 5 items after sorting (spec section 11.2)
  const soonMaintenanceItemsWithVM = soonMaintenanceItemsWithVMSorted.slice(0, 5);

  // Align status with Soon visibility: if item is in Soon block but has OK status, treat it as SOON for UI
  // This ensures UI consistency - items in Soon block should have SOON status (except OVERDUE)
  // This is UI-level alignment, calcServiceStatus remains a pure calculation function
  const soonItemIds = new Set(soonMaintenanceItems.map(item => item.id));
  itemsWithStatus.forEach(itemWithStatus => {
    if (soonItemIds.has(itemWithStatus.item.id) && itemWithStatus.statusResult) {
      const status = itemWithStatus.statusResult.status;
      // Only update OK to SOON, never change OVERDUE
      if (status === 'OK') {
        // Update statusResult for UI consistency (this is UI-level, not changing calcServiceStatus logic)
        itemWithStatus.statusResult = {
          ...itemWithStatus.statusResult,
          status: 'SOON',
          why: itemWithStatus.statusResult.why || t("Скоро обслуживание"),
        };
        // Also update urgency for consistency
        itemWithStatus.urgency = 'SOON';
      }
    }
  });

  // Filter items eligible for Home upcoming dashboard:
  // - Must have lastEvent (baseline replacement)
  // - Must be OVERDUE or SOON (using statusResult.status as single source of truth)
  // Note: statusResult.status may be updated above for UI consistency
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
          `rate=${dailyKmRateUsed !== null ? dailyKmRateUsed.toFixed(1) : 'n/a'}${isFallback ? '(fallback)' : ''} | ` +
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
          <div className="mileage-label">
            {estimatedOdometer.isEstimated ? RU.home.estimatedMileage : RU.home.lastActualMileage}
          </div>
          <div className="mileage-value">
            {estimatedOdometer.estimatedKm !== null
              ? `${estimatedOdometer.isEstimated ? '~' : ''}${formatNumber(estimatedOdometer.estimatedKm)} ${RU.common.km}`
              : RU.home.noEntriesYet}
          </div>
          {maxMileageEntry && (
            <div className="mileage-date">
              {RU.home.lastMeasurement}: {formatNumber(maxMileageEntry.mileage_km)} {RU.common.km} ·{' '}
              <LocalDateTime iso={maxMileageEntry.occurred_at} />
            </div>
          )}
        </div>

        {/* TO-BE: Daily mileage rate hint (independent of Soon Maintenance block visibility) */}
        <div className="prediction-hint" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
          <p className="prediction-hint-text">
            {dailyRate !== null && dailyRate > 0 ? (
              isFallbackRate ? (
                <>{t("Средний пробег: ~")}{formatNumber(Math.round(dailyRate))} {RU.common.km}{t("/день")}</>
              ) : (
                <>{t("Средний пробег за последние 60 дней: ~")}{formatNumber(Math.round(dailyRate))} {RU.common.km}{t("/день")}</>
              )
            ) : (
              <>{t("Средний пробег: недостаточно данных")}</>
            )}
          </p>
        </div>

        <div className="add-mileage-section">
          <AddMileageForm />
        </div>

        {/* Soon Maintenance Block - Conditional */}
        <HomeSoonMaintenanceBlock 
          itemsWithVM={soonMaintenanceItemsWithVM} 
        dailyKmRate={forecastDailyKmRate ?? undefined}
          isFallbackRate={isFallbackRate}
          windowDaysUsed={windowDaysUsed}
        samplesUsed={undefined}
        fallbackReason={dailyRateResult.reason ?? null}
          odometerEntries={process.env.NODE_ENV !== 'production' ? odometerEntries : []}
          latestEntry={process.env.NODE_ENV !== 'production' ? (odometerEntries[0] ?? null) : null}
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
