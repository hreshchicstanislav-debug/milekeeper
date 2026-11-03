'use client';

import { useCopy } from '@/lib/i18n/client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LocalDateTime } from '@/app/components/LocalDateTime';
import type { ServiceItem, ServiceEvent } from '@/lib/db/types';
import AddServiceRecordButton from '@/app/components/AddServiceRecordButton';
import ItemHistoryList from '@/app/components/ItemHistoryList';
import { useItemHistory } from '@/app/components/useItemHistory';
import { useToast } from '@/app/components/ToastProvider';
import { findLastReplacement } from '@/lib/service/serviceEventKinds';
import AddServiceItemForm from '@/app/components/AddServiceItemForm';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';
import type { EstimatedOdometerResult } from '@/lib/service/estimatedOdometer';
import { logMileageComparison } from '@/lib/dev/mileageDiagnostics';
import { getAppNow } from '@/lib/appNow';

interface ItemDetailsPageClientProps {
  item: ServiceItem;
  /** Actual (manually entered) odometer — used for recording real service events */
  latestOdometer: any;
  /** Estimated current odometer — used for forecasts and forecast UI */
  estimatedOdometer: EstimatedOdometerResult;
  lastEvent?: any;
  dailyKmRate?: number | null;
  initialTab?: 'history' | 'calc';
}

export default function ItemDetailsPageClient({
  item,
  latestOdometer,
  estimatedOdometer,
  lastEvent: propLastEvent,
  dailyKmRate = null,
  initialTab = 'history',
}: ItemDetailsPageClientProps) {
  const { RU, t, formatNumber, formatServiceTimeFromSignedDays, path, systemText, errorMessageText } = useCopy();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const historyState = useItemHistory(item.id);
  const history = historyState.events;
  const [editingItem, setEditingItem] = useState<ServiceItem | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'calc'>(initialTab);
  const itemDetailsBodyRef = useRef<HTMLDivElement>(null);

  // Load history on mount and when the history tab is shown again
  const { reload: reloadHistory } = historyState;
  useEffect(() => {
    if (activeTab === 'history') {
      reloadHistory();
    }
  }, [activeTab, reloadHistory]);

  // No mount-time or visibilitychange refresh here.
  // This route is `export const dynamic = 'force-dynamic'`, so every navigation to it
  // already runs the server component against the database. The removed effect fired a
  // `router.replace('?_t=...')` plus a `router.refresh()` on every mount and on every
  // return to the app, which meant three full server renders per tap.

  // Update URL when tab changes (only if different from current URL)
  useEffect(() => {
    const currentTab = searchParams.get('tab') || 'history';
    // Only update URL if activeTab differs from URL param
    if (activeTab !== currentTab) {
      const params = new URLSearchParams();
      if (activeTab === 'calc') {
        params.set('tab', 'calc');
      }
      const newUrl = `/items/${item.id}${params.toString() ? `?${params.toString()}` : ''}`;
      router.replace(path(newUrl), { scroll: false });
    }
  }, [activeTab, item.id, router]); // Removed searchParams from dependencies to break the loop

  const handleRecordSuccess = (kind: ServiceEvent['kind']) => {
    toast.success({ title: t("Готово"), subtitle: RU.items.serviceEvent.saved[kind], durationMs: 2000 });
    reloadHistory();
    router.refresh();
  };

  const handleRecordDeleted = (event: ServiceEvent, outcome: 'deleted' | 'already-deleted') => {
    // The loaded pages stay valid without the deleted record; a record that was already
    // gone means the history changed elsewhere, so load it again.
    if (outcome === 'deleted') historyState.removeEvent(event.id);
    else reloadHistory();
    // Recompute the last replacement and the forecast from the remaining records.
    router.refresh();
  };

  const handleOpenSettings = () => {
    // Open edit form modal
    setEditingItem(item);
  };

  const handleRefresh = () => {
    router.refresh();
  };

  // Show only relevant interval based on measurement_mode
  const intervals: string[] = [];
  if (item.measurement_mode === 'km' && item.interval_km) {
    intervals.push(RU.items.everyKm.replace('{value}', formatNumber(item.interval_km)));
  } else if (item.measurement_mode === 'calendar' && item.interval_days) {
    intervals.push(RU.items.everyDays.replace('{value}', formatNumber(item.interval_days)));
  }

  // Last replacement: from the server, or from the loaded history. Checks and top-ups
  // never count — they must not reset the interval or the forecast.
  const lastEvent: ServiceEvent | null = propLastEvent || findLastReplacement(history);

  // Calculate status using helper (forecasts run on the estimated odometer)
  const currentMileage = estimatedOdometer.estimatedKm;
  
  // Diagnostic logging: log what we received from server component
  useEffect(() => {
    if (latestOdometer) {
      // Log the record we received (for comparison with Home page logs)
      logMileageComparison(
        `ItemDetails:${item.title}`,
        { query: 'getMaxMileageEntry (server component)', mileage: latestOdometer.mileage_km },
        { query: 'latestOdometer prop (client component)', mileage: latestOdometer.mileage_km }
      );
    } else {
      // Log if we received null
      logMileageComparison(
        `ItemDetails:${item.title}`,
        { query: 'getMaxMileageEntry (server component)', mileage: null },
        { query: 'latestOdometer prop (client component)', mileage: null }
      );
    }
  }, [latestOdometer, item.title]);
  
  const statusResult = calcServiceStatus({
    serviceItem: item,
    latestOdometerMileageKm: currentMileage,
    lastEvent,
    dailyKmRate,
    now: getAppNow(),
  });

  const formatMetricValue = (value: number, unit: string) => {
    if (unit === 'дней') {
      return formatServiceTimeFromSignedDays(value);
    }
    if (value <= 0) {
      return `${RU.items.details.calcExceeded} ${formatNumber(Math.abs(value))} ${systemText(unit)}`;
    }
    return `${formatNumber(value)} ${systemText(unit)}`;
  };

  return (
    <div className="item-details-page-route">
      <div className="item-details-page">
        <div className="item-details-page-shell">
        <div className="item-details-page-scroll">
        {/* Sticky Header */}
        <div className="item-details-page-header">
        <div className="item-details-page-header-row">
          <Link href={path('/items')} className="item-details-page-back">
            ←
          </Link>
          <div className="item-details-page-title-wrapper">
            <h1 className="item-details-page-title">{item.title}</h1>
            {intervals.length > 0 && (
              <div className="item-details-page-subtitle">{intervals.join(' • ')}</div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="details-tabs">
          <button
            type="button"
            className={`details-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            {RU.items.details.tabHistory}
          </button>
          <button
            type="button"
            className={`details-tab ${activeTab === 'calc' ? 'active' : ''}`}
            onClick={() => setActiveTab('calc')}
          >
            {RU.items.details.tabCalc}
          </button>
        </div>
        </div>

      {/* Scrollable Body */}
      <main className="item-details-page-body" ref={itemDetailsBodyRef}>
        {activeTab === 'history' ? (
          <div className="item-history">
            <h3 className="item-history-title">{RU.items.historyTitle}</h3>
            {historyState.isLoading ? (
              <div className="item-history-loading">{t("Загрузка…")}</div>
            ) : historyState.error ? (
              <div className="item-history-error">{errorMessageText(historyState.error)}</div>
            ) : history.length === 0 ? (
              <div className="item-history-empty">{RU.items.historyEmpty}</div>
            ) : (
              <ItemHistoryList
                events={history}
                previousReplacement={historyState.previousReplacement}
                hasMore={historyState.hasMore}
                isLoadingMore={historyState.isLoadingMore}
                loadMoreFailed={historyState.loadMoreFailed}
                onLoadMore={historyState.loadMore}
                onDeleted={handleRecordDeleted}
              />
            )}
          </div>
        ) : (
          <div className="item-history">
            <h3 className="item-history-title">{RU.items.details.calcTitle}</h3>
            
            {/* Current mileage */}
            <div className="calc-block">
              <div className="calc-row">
                <span className="k">{RU.items.details.calcCurrentMileage}</span>
                <span className="v">
                  {currentMileage !== null
                    ? `${estimatedOdometer.isEstimated ? '~' : ''}${formatNumber(currentMileage)} ${RU.common.km}`
                    : RU.items.details.calcNoCurrentMileage}
                </span>
              </div>
            </div>

            {/* Last replacement */}
            <div className="calc-block">
              <div className="calc-row">
                <span className="k">{RU.items.details.calcLastReplacement}</span>
                <span className="v">
                  {lastEvent ? (
                    <>
                      <LocalDateTime iso={lastEvent.occurred_at} /> • {formatNumber(lastEvent.mileage_km)} {RU.common.km}
                    </>
                  ) : (
                    RU.items.details.calcNoLastReplacement
                  )}
                </span>
              </div>
            </div>

            {/* Intervals */}
            {item.measurement_mode === 'km' && item.interval_km !== null && (
              <div className="calc-block">
                <div className="calc-row" style={{ marginBottom: '8px', fontWeight: 600 }}>
                  <span>{RU.items.details.calcIntervals}</span>
                </div>
                <div className="calc-row">
                  <span className="k">{RU.items.details.calcByKm}</span>
                  <span className="v">{formatNumber(item.interval_km)} {RU.common.km}</span>
                </div>
              </div>
            )}
            {item.measurement_mode === 'calendar' && item.interval_days !== null && (
              <div className="calc-block">
                <div className="calc-row" style={{ marginBottom: '8px', fontWeight: 600 }}>
                  <span>{RU.items.details.calcIntervals}</span>
                </div>
                <div className="calc-row">
                  <span className="k">{RU.items.details.calcByTime}</span>
                  <span className="v">{formatNumber(item.interval_days)}  {t("дней")}</span>
                </div>
              </div>
            )}

            {/* Notify thresholds */}
            <div className="calc-block">
              <div className="calc-row" style={{ marginBottom: '8px', fontWeight: 600 }}>
                <span>{RU.items.details.calcNotifyThresholds}</span>
              </div>
              <div className="calc-row">
                <span className="k">{t("Уведомлять за, дней")}</span>
                <span className="v">{formatNumber(item.notify_before_days)}  {t("дней")}</span>
              </div>
            </div>

            {/* Average daily km rate (for km-mode items) */}
            {item.measurement_mode === 'km' && (
              <div className="calc-block">
                <div className="calc-row">
                  <span className="k">{RU.items.details.calcAvgDaily}</span>
                  <span className="v">
                    {statusResult.dailyKmRateUsed !== null && statusResult.dailyKmRateUsed !== undefined
                      ? `${formatNumber(Math.round(statusResult.dailyKmRateUsed))} ${RU.common.km}${t("/день")}`
                      : RU.items.details.calcNoForecast}
                  </span>
                </div>
                {statusResult.dailyKmRateUsed !== null && statusResult.dailyKmRateUsed !== undefined && (
                  <div className="calc-row" style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(0,0,0,0.55)' }}>
                    <span className="k">{RU.items.details.calcAvgDailyHint}</span>
                  </div>
                )}
              </div>
            )}

            {/* Primary metric (limiting factor) */}
            {statusResult.status !== 'UNKNOWN' && (
              <>
                <div className="calc-block">
                  <div className="calc-row" style={{ marginBottom: '8px', fontWeight: 600 }}>
                    <span>{RU.items.details.calcPrimary}</span>
                  </div>
                  <div className="calc-row">
                    <span className="k">{systemText(statusResult.primary.label)}</span>
                    <span className="v">
                      {formatMetricValue(statusResult.primary.remainingValue, statusResult.primary.unit)}
                    </span>
                  </div>
                  {statusResult.primary.kind === 'km' && (
                    <>
                      <div className="calc-row" style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(0,0,0,0.55)' }}>
                        <span className="k">{t("Следующая замена")}</span>
                        <span className="v">{formatNumber(statusResult.primary.dueValue)} {RU.common.km}</span>
                      </div>
                      {item.measurement_mode === 'km' && statusResult.remainingDays !== null && !Number.isNaN(statusResult.remainingDays) && (
                        <div className="calc-row" style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(0,0,0,0.55)' }}>
                          <span className="k">{t("Прогноз дней")}</span>
                          <span className="v">{formatServiceTimeFromSignedDays(statusResult.remainingDays)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {statusResult.primary.kind === 'time' && item.measurement_mode === 'calendar' && (
                    <div className="calc-row" style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(0,0,0,0.55)' }}>
                      <span className="k">{t("Следующая замена")}</span>
                      <span className="v">
                        <LocalDateTime iso={statusResult.primary.dueDate?.toISOString()} dateOnly />
                      </span>
                    </div>
                  )}
                </div>

                {/* Secondary metric (if exists) */}
                {statusResult.secondary && statusResult.secondary.remainingValue !== null && (
                  <div className="calc-block">
                    <div className="calc-row" style={{ marginBottom: '8px', fontWeight: 600 }}>
                      <span>{RU.items.details.calcSecondary}</span>
                    </div>
                    <div className="calc-row">
                      <span className="k">{systemText(statusResult.secondary.label)}</span>
                      <span className="v">
                        {formatMetricValue(statusResult.secondary.remainingValue, statusResult.secondary.unit)}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
        </div>

      {/* Footer */}
      <div className="item-details-page-footer">
        <button
          type="button"
          onClick={handleOpenSettings}
          className="btn btn-secondary"
        >
          {RU.items.settingsButton}
        </button>
        <div className="item-details-action-primary" onClick={(e) => e.stopPropagation()}>
          <AddServiceRecordButton
            serviceItemId={item.id}
            serviceItemTitle={item.title}
            defaultMileage={latestOdometer?.mileage_km ?? null}
            lastReadingAt={latestOdometer?.occurred_at ?? null}
            disabled={!latestOdometer}
            disabledHint={RU.items.noMileageHint}
            onSuccess={handleRecordSuccess}
          />
        </div>
      </div>
        </div>
      </div>

      {/* Edit form modal (opened from Settings button) */}
      {editingItem && (
            <AddServiceItemForm
              mode="edit"
              initialItem={editingItem}
              onClose={() => setEditingItem(null)}
              onSuccess={handleRefresh}
              onReturnToDetails={(itemId) => {
                // Close edit form and refresh
                setEditingItem(null);
                handleRefresh();
              }}
            />
      )}
    </div>
  );
}

