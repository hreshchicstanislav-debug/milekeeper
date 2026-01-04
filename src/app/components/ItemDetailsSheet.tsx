'use client';

import { useState, useEffect, useRef } from 'react';
import { RU, formatNumber } from '@/lib/copy/ru';
import { formatDateTimeRu } from '@/lib/ui/formatDateTimeRu';
import type { ServiceItem, ServiceEvent } from '@/lib/db/types';
import MarkReplacementButton from './MarkReplacementButton';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';
import { useToast } from './ToastProvider';
import { lockScroll, unlockScroll } from '@/lib/ui/scrollLock';
import { modalOpened, modalClosed } from '@/lib/ui/modalOpen';

// Hook for swipe-to-close gesture
function useSwipeToClose<T extends HTMLElement>(
  elementRef: React.RefObject<T | null>,
  onClose: () => void,
  enabled: boolean = true
) {
  const startYRef = useRef<number | null>(null);
  const currentYRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !elementRef.current) return;

    const element = elementRef.current;

    const handleStart = (clientY: number) => {
      startYRef.current = clientY;
      currentYRef.current = clientY;
      startTimeRef.current = Date.now();
      isDraggingRef.current = true;
      element.style.transition = 'none';
    };

    const handleMove = (clientY: number) => {
      if (!isDraggingRef.current || startYRef.current === null) return;

      const deltaY = clientY - startYRef.current;
      
      // Only allow downward swipes
      if (deltaY > 0) {
        currentYRef.current = clientY;
        // Apply rubber-band effect: reduce movement for larger drags
        const dragAmount = Math.min(deltaY, deltaY * 0.5 + 50);
        element.style.transform = `translateY(${dragAmount}px)`;
      }
    };

    const handleEnd = () => {
      if (!isDraggingRef.current || startYRef.current === null || currentYRef.current === null || startTimeRef.current === null) {
        isDraggingRef.current = false;
        return;
      }

      const deltaY = currentYRef.current - startYRef.current;
      const deltaTime = Date.now() - startTimeRef.current;
      const velocity = Math.abs(deltaY / deltaTime); // px/ms

      element.style.transition = 'transform 0.3s ease-out';

      // Close if dragged > 80px or high velocity (> 0.5 px/ms)
      if (deltaY > 80 || (deltaY > 30 && velocity > 0.5)) {
        element.style.transform = 'translateY(100%)';
        setTimeout(() => {
          onClose();
        }, 300);
      } else {
        // Snap back
        element.style.transform = 'translateY(0)';
      }

      startYRef.current = null;
      currentYRef.current = null;
      startTimeRef.current = null;
      isDraggingRef.current = false;
    };

    // Touch events
    const handleTouchStart = (e: TouchEvent) => {
      // Don't start swipe if user is interacting with scrollable content
      const target = e.target as HTMLElement;
      const scrollable = target.closest('.item-history, .form-content');
      if (scrollable) {
        // Only allow swipe if at the very top of scrollable content (within 2px tolerance)
        if (scrollable.scrollTop > 2) {
          return; // User is scrolling content, don't start swipe
        }
        // Check if content is actually scrollable
        if (scrollable.scrollHeight > scrollable.clientHeight + 2) {
          // Content is scrollable, only allow swipe from absolute top
          if (scrollable.scrollTop > 0) {
            return;
          }
        }
      }
      handleStart(e.touches[0].clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      
      // Only preventDefault if we're actually dragging the sheet
      // Check if user is trying to scroll content instead
      const target = e.target as HTMLElement;
      const scrollable = target.closest('.item-history, .form-content');
      if (scrollable && scrollable.scrollTop > 0) {
        // User is scrolling content, cancel drag
        isDraggingRef.current = false;
        startYRef.current = null;
        currentYRef.current = null;
        element.style.transition = '';
        element.style.transform = '';
        return;
      }
      
      e.preventDefault(); // Prevent scrolling only when dragging sheet
      handleMove(e.touches[0].clientY);
    };

    const handleTouchEnd = () => {
      handleEnd();
    };

    // Pointer events (for mouse support)
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return; // Only handle touch
      const target = e.target as HTMLElement;
      const scrollable = target.closest('.item-history, .form-content');
      if (scrollable) {
        // Only allow swipe if at the very top of scrollable content (within 2px tolerance)
        if (scrollable.scrollTop > 2) {
          return; // User is scrolling content, don't start swipe
        }
        // Check if content is actually scrollable
        if (scrollable.scrollHeight > scrollable.clientHeight + 2) {
          // Content is scrollable, only allow swipe from absolute top
          if (scrollable.scrollTop > 0) {
            return;
          }
        }
      }
      handleStart(e.clientY);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current || e.pointerType === 'mouse') return;
      
      // Check if user is trying to scroll content instead of dragging sheet
      const target = e.target as HTMLElement;
      const scrollable = target.closest('.item-history, .form-content');
      
      // If user is scrolling content (scrollTop > 0), cancel drag immediately
      if (scrollable && scrollable.scrollTop > 0) {
        // User is scrolling content, cancel drag and allow native scroll
        isDraggingRef.current = false;
        startYRef.current = null;
        currentYRef.current = null;
        startTimeRef.current = null;
        element.style.transition = '';
        element.style.transform = '';
        return; // Don't preventDefault - allow native scroll
      }
      
      // Only preventDefault when we're actually dragging the sheet (not scrolling content)
      e.preventDefault();
      handleMove(e.clientY);
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        handleEnd();
      }
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
    };
  }, [enabled, elementRef, onClose]);
}

interface ItemDetailsSheetProps {
  item: ServiceItem;
  latestOdometer: any;
  lastEvent?: any; // Last service event for this item (optional, can be computed from history)
  dailyKmRate?: number | null; // Daily km rate for forecasting (optional)
  onClose: () => void;
  onOpenSettings: (item: ServiceItem) => void;
  onRefresh?: () => void;
}

export default function ItemDetailsSheet({
  item,
  latestOdometer,
  lastEvent: propLastEvent,
  dailyKmRate = null,
  onClose,
  onOpenSettings,
  onRefresh,
}: ItemDetailsSheetProps) {
  const toast = useToast();
  const [history, setHistory] = useState<ServiceEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'calc'>('history');
  const lastLoadedKeyRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const itemHistoryRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const itemDetailsBodyRef = useRef<HTMLDivElement>(null);

  // Swipe-to-close gesture
  useSwipeToClose<HTMLDivElement>(modalContentRef, onClose, true);

  // Lock body scroll and register modal when sheet is open (using refcount manager)
  useEffect(() => {
    lockScroll('ItemDetailsSheet');
    modalOpened('ItemDetailsSheet');
    return () => {
      unlockScroll('ItemDetailsSheet');
      modalClosed('ItemDetailsSheet');
    };
  }, []);

  const loadHistory = async (force = false) => {
    const limit = 10;
    const key = `${item.id}:${limit}`;

    // Guard against fetch-loop: skip if already loaded (unless forced)
    if (!force && lastLoadedKeyRef.current === key) {
      return;
    }

    // Cancel previous request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/service-events?itemId=${encodeURIComponent(item.id)}&limit=${limit}`,
        {
          cache: 'no-store',
          signal: abortController.signal,
        }
      );

      // Check if request was aborted
      if (abortController.signal.aborted) {
        return;
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to load history');
      }

      setHistory(data.events || []);
      lastLoadedKeyRef.current = key;
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const errorMessage =
        err instanceof Error
          ? err.message
          : RU.items.historyLoadError || 'Не удалось загрузить историю';
      setError(errorMessage);
      if (process.env.NODE_ENV !== 'production') {
        console.error('[ItemDetailsSheet] Failed to load history:', err);
      }
    } finally {
      // Only update loading state if request wasn't aborted
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadHistory();
    // Cleanup: abort request on unmount or item change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Removed duplicate body scroll lock - already handled above at line 223

  // Reset scroll positions on mount
  useEffect(() => {
    // CRITICAL: Reset ALL scroll positions immediately on mount
    // This must happen before any layout calculations
    const resetAllScrolls = () => {
      if (itemHistoryRef.current) {
        itemHistoryRef.current.scrollTop = 0;
      }
      if (modalContentRef.current) {
        modalContentRef.current.scrollTop = 0;
      }
      // Also reset window scroll if any
      window.scrollTo(0, 0);
    };
    
    // Reset immediately
    resetAllScrolls();
    
    // Reset scroll to top - CRITICAL: must reset both history and content scroll
    if (itemHistoryRef.current) {
      itemHistoryRef.current.scrollTop = 0;
      
      // Also reset modal-content scroll if it exists
      const modalContent = modalContentRef.current;
      if (modalContent) {
        modalContent.scrollTop = 0;
      }
    }
  }, [item.id]);

  const handleRefresh = () => {
    loadHistory(true); // Force reload
    if (onRefresh) onRefresh();
  };

  const handleMarkReplacementSuccess = () => {
    // Manual test checklist (smoke test):
    // 1. Open item details sheet
    // 2. Tap "Отметить замену"
    // 3. Fill form and submit
    // 4. ✅ Toast appears centered with "Готово" / "Замена сохранена"
    // 5. ✅ Sheet closes automatically
    // 6. ✅ /items list shows updated "Последняя замена" (no manual reload)
    // 7. ✅ Home "Скоро замена" recalculates (item may disappear or move)
    // 8. ✅ No double refresh loops (router.refresh called once)
    // 9. ✅ Rapid taps create only one event (button disabled while submitting)
    
    // Show toast first (before closing sheet to ensure it's called)
    // Toast provider is global, so it will persist even if sheet unmounts
    toast.success({
      title: 'Готово',
      subtitle: 'Замена отмечена',
      durationMs: 2000,
    });
    
    // Close the details sheet
    onClose();
    
    // Refresh data (history and parent component)
    // This will trigger router.refresh() in AddServiceEventForm as well,
    // but hasRefreshedRef guard prevents double refresh
    handleRefresh();
  };

  // Show only relevant interval based on measurement_mode
  const intervals: string[] = [];
  if (item.measurement_mode === 'km' && item.interval_km) {
    intervals.push(RU.items.everyKm.replace('{value}', formatNumber(item.interval_km)));
  } else if (item.measurement_mode === 'calendar' && item.interval_days) {
    intervals.push(RU.items.everyDays.replace('{value}', formatNumber(item.interval_days)));
  }

  // Get last event: from prop, or from history if available
  const lastEvent = propLastEvent || (history.length > 0 ? history[0] : null);

  // Calculate status using new helper
  const currentMileage = latestOdometer?.mileage_km ?? null;
  const statusResult = calcServiceStatus({
    serviceItem: item,
    latestOdometerMileageKm: currentMileage,
    lastEvent,
    dailyKmRate,
  });

  // Dev-only: compare old vs new logic (temporary)
  if (process.env.NODE_ENV !== 'production' && lastEvent && currentMileage !== null) {
    const now = new Date();
    const lastServiceMileage = lastEvent.mileage_km;
    const lastServiceDate = new Date(lastEvent.occurred_at);
    
    let oldRemainingKm: number | null = null;
    let oldRemainingDays: number | null = null;
    let oldUrgency: 'OVERDUE' | 'SOON' | 'OK' = 'OK';
    
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
    
    console.log(`[ItemDetailsSheet] ${item.title}:`, {
      old: { urgency: oldUrgency, remainingKm: oldRemainingKm, remainingDays: oldRemainingDays },
      new: { 
        status: statusResult.status, 
        limitingFactor: statusResult.limitingFactor,
        primaryRemaining: statusResult.primary.remainingValue,
        secondaryRemaining: statusResult.secondary?.remainingValue ?? null,
      },
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" ref={modalContentRef} onClick={(e) => e.stopPropagation()}>
        <div className="item-details-header">
          {/* Grabber bar - iOS style */}
          <div className="sheet-grabber" />
          
          {/* Header top row: title + close button */}
          <div className="item-details-header-row">
            <div>
              <h2 className="item-details-title">{item.title}</h2>
              {intervals.length > 0 && (
                <div className="item-details-sub">{intervals.join(' • ')}</div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="close-button"
              aria-label={RU.items.closeButton}
            >
              ×
            </button>
          </div>

          {/* Tabs - part of sticky header */}
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

        {/* Scrollable body content - wraps tab content */}
        <div className="item-details-body" ref={itemDetailsBodyRef}>
          {activeTab === 'history' ? (
            <div className="item-history">
            <h3 className="item-history-title">{RU.items.historyTitle}</h3>
            {isLoading ? (
              <div className="item-history-loading">
                Загрузка…
              </div>
            ) : error ? (
              <div className="item-history-error">
                {error}
              </div>
            ) : history.length === 0 ? (
              <div className="item-history-empty">
                {RU.items.historyEmpty}
              </div>
            ) : (
              <>
                <ul className="item-history-list">
                  {history.map((event) => (
                    <li key={event.id} className="item-history-row">
                      <span className="item-history-date">
                        {formatDateTimeRu(event.occurred_at)}
                      </span>
                      <span className="item-history-mileage">
                        {formatNumber(event.mileage_km)} {RU.common.km}
                      </span>
                    </li>
                  ))}
                </ul>
                {history.length >= 10 && (
                  <div className="item-history-hint">
                    {RU.items.showAllHistoryHint}
                  </div>
                )}
              </>
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
                  {currentMileage !== null ? `${formatNumber(currentMileage)} ${RU.common.km}` : RU.items.details.calcNoCurrentMileage}
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
                      {formatDateTimeRu(lastEvent.occurred_at)} • {formatNumber(lastEvent.mileage_km)} {RU.common.km}
                    </>
                  ) : (
                    RU.items.details.calcNoLastReplacement
                  )}
                </span>
              </div>
            </div>

            {/* Intervals - show only relevant based on measurement_mode */}
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
                  <span className="v">{formatNumber(item.interval_days)} дней</span>
                </div>
              </div>
            )}

            {/* Notify thresholds - show only days threshold (km threshold removed from UI) */}
            <div className="calc-block">
              <div className="calc-row" style={{ marginBottom: '8px', fontWeight: 600 }}>
                <span>{RU.items.details.calcNotifyThresholds}</span>
              </div>
              <div className="calc-row">
                <span className="k">Уведомлять за, дней</span>
                <span className="v">{formatNumber(item.notify_before_days)} дней</span>
              </div>
            </div>

            {/* Average daily km rate (for km-mode items) */}
            {item.measurement_mode === 'km' && (
              <div className="calc-block">
                <div className="calc-row">
                  <span className="k">{RU.items.details.calcAvgDaily}</span>
                  <span className="v">
                    {statusResult.dailyKmRateUsed !== null && statusResult.dailyKmRateUsed !== undefined
                      ? `${formatNumber(Math.round(statusResult.dailyKmRateUsed))} ${RU.common.km}/день`
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
                    <span className="k">{statusResult.primary.label}</span>
                    <span className="v">
                      {statusResult.primary.remainingValue <= 0 
                        ? `${RU.items.details.calcExceeded} ${formatNumber(Math.abs(statusResult.primary.remainingValue))} ${statusResult.primary.unit}`
                        : `${formatNumber(statusResult.primary.remainingValue)} ${statusResult.primary.unit}`}
                    </span>
                  </div>
                  {statusResult.primary.kind === 'km' && (
                    <>
                      <div className="calc-row" style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(0,0,0,0.55)' }}>
                        <span className="k">Следующая замена</span>
                        <span className="v">{formatNumber(statusResult.primary.dueValue)} {RU.common.km}</span>
                      </div>
                      {/* Show predicted days for km mode if available */}
                      {item.measurement_mode === 'km' && statusResult.remainingDays !== null && !Number.isNaN(statusResult.remainingDays) && (
                        <div className="calc-row" style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(0,0,0,0.55)' }}>
                          <span className="k">Прогноз дней</span>
                          <span className="v">~{formatNumber(Math.ceil(statusResult.remainingDays))} дн.</span>
                        </div>
                      )}
                      {item.measurement_mode === 'km' && statusResult.remainingKm !== null && statusResult.remainingDays === null && (
                        <div className="calc-row" style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(0,0,0,0.55)' }}>
                          <span className="k">Прогноз дней</span>
                          <span className="v">{RU.items.details.calcNoForecast}</span>
                        </div>
                      )}
                    </>
                  )}
                  {statusResult.primary.kind === 'time' && item.measurement_mode === 'calendar' && (
                    <div className="calc-row" style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(0,0,0,0.55)' }}>
                      <span className="k">Следующая замена</span>
                      <span className="v">{formatDateTimeRu(new Date(statusResult.primary.dueValue))}</span>
                    </div>
                  )}
                </div>

                {/* Secondary metric (if available) - only for calendar mode with both intervals */}
                {statusResult.secondary && item.measurement_mode === 'calendar' && (
                  <div className="calc-block">
                    <div className="calc-row" style={{ marginBottom: '8px', fontWeight: 600, fontSize: '13px' }}>
                      <span>{RU.items.details.calcSecondary}</span>
                    </div>
                    <div className="calc-row">
                      <span className="k" style={{ fontSize: '13px' }}>{statusResult.secondary.label}</span>
                      <span className="v" style={{ fontSize: '13px' }}>
                        {statusResult.secondary.remainingValue !== null && statusResult.secondary.remainingValue <= 0
                          ? `${RU.items.details.calcExceeded} ${formatNumber(Math.abs(statusResult.secondary.remainingValue))} ${statusResult.secondary.unit}`
                          : statusResult.secondary.remainingValue !== null
                          ? `${formatNumber(statusResult.secondary.remainingValue)} ${statusResult.secondary.unit}`
                          : '—'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Status explanation */}
                <div className="calc-block">
                  <div className="calc-row" style={{ marginBottom: '8px', fontWeight: 600 }}>
                    <span>{RU.items.details.calcStatusWhy}</span>
                  </div>
                  <div className="calc-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                    <span style={{ 
                      fontSize: '13px', 
                      color: statusResult.status === 'OVERDUE' ? '#c33' : statusResult.status === 'SOON' ? '#f59e0b' : 'rgba(0,0,0,0.7)' 
                    }}>
                      {statusResult.why}
                    </span>
                  </div>
                </div>
              </>
            )}
            </div>
          )}
        </div>

        <div className="item-details-actions" ref={footerRef}>
          <button
            type="button"
            onClick={() => onOpenSettings(item)}
            className="btn btn-secondary"
          >
            {RU.items.settingsButton}
          </button>
          <div className="item-details-action-primary" onClick={(e) => e.stopPropagation()}>
            <MarkReplacementButton
              serviceItemId={item.id}
              serviceItemTitle={item.title}
              defaultMileage={latestOdometer?.mileage_km ?? null}
              disabled={!latestOdometer}
              disabledHint={RU.items.noMileageHint}
              onSuccess={handleMarkReplacementSuccess}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

