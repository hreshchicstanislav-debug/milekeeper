'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { seedDemoData, simulateTripRange, wipeAllData } from '@/lib/actions/devActions';
import { RU } from '@/lib/copy/ru';
import { getAppMode, setAppMode, AppMode } from '@/lib/appMode';
import { getAppNow, setAppNow, advanceAppNow, resetAppNow } from '@/lib/appNow';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from '@/lib/time/datetimeLocal';

interface DevToolsPanelProps {
  onExpandedChange?: (isExpanded: boolean) => void;
}

export default function DevToolsPanel({ onExpandedChange }: DevToolsPanelProps) {
  // Дополнительная проверка для безопасности (не должен рендериться в production)
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  
  // Notify parent when expanded state changes
  useEffect(() => {
    if (onExpandedChange) {
      onExpandedChange(isOpen);
    }
  }, [isOpen, onExpandedChange]);

  // Auto-scroll to panel when expanded
  // DISABLED: When dev panel is expanded, HomeContentClient enables full-page scrolling
  // and resets scroll to top. Auto-scrolling here would interfere with that.
  // User can manually scroll to see the dev panel.
  // useEffect(() => {
  //   if (isOpen && panelRef.current) {
  //     // Use requestAnimationFrame to ensure DOM is updated
  //     requestAnimationFrame(() => {
  //       if (panelRef.current) {
  //         panelRef.current.scrollIntoView({ 
  //           behavior: 'smooth', 
  //           block: 'start' 
  //         });
  //         
  //         // On iOS, sometimes scrollIntoView doesn't account for safe areas properly
  //         // Add a small additional scroll after a short delay
  //         setTimeout(() => {
  //           if (panelRef.current) {
  //             // Check if we need additional scroll (panel might be cut off at bottom)
  //             const rect = panelRef.current.getBoundingClientRect();
  //             const viewportHeight = window.innerHeight || window.visualViewport?.height || 0;
  //             const bottomNavHeight = 88; // Approximate bottom nav height + safe area
  //             const visibleBottom = viewportHeight - bottomNavHeight;
  //             
  //             // If panel bottom is below visible area, scroll a bit more
  //             if (rect.bottom > visibleBottom) {
  //               const scrollAmount = Math.min(rect.bottom - visibleBottom + 20, 120);
  //               window.scrollBy({ 
  //                 top: scrollAmount, 
  //                 behavior: 'smooth' 
  //               });
  //             }
  //           }
  //         }, 300);
  //       }
  //     });
  //   }
  // }, [isOpen]);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [appMode, setAppModeState] = useState<AppMode>(AppMode.LIVE);
  const [appNow, setAppNowState] = useState<Date>(new Date());
  const [appNowInput, setAppNowInput] = useState<string>('');
  const router = useRouter();

  // Initialize app mode from localStorage on mount
  useEffect(() => {
    setAppModeState(getAppMode());
  }, []);

  // Update AppNow display when mode changes or component mounts
  useEffect(() => {
    if (appMode === AppMode.TEST) {
      const current = getAppNow();
      setAppNowState(current);
      // Format for datetime-local input: YYYY-MM-DDTHH:mm
      setAppNowInput(toDateTimeLocalValue(current));
    }
  }, [appMode]);

  // Refresh AppNow display periodically (every second) when in TEST mode
  useEffect(() => {
    if (appMode !== AppMode.TEST) {
      return;
    }

    const interval = setInterval(() => {
      const current = getAppNow();
      setAppNowState(current);
      setAppNowInput(toDateTimeLocalValue(current));
    }, 1000);

    return () => clearInterval(interval);
  }, [appMode]);

  const handleSeed = async () => {
    setIsLoading(true);
    setStatus(RU.devTools.statusRunning);
    try {
      const result = await seedDemoData();
      setStatus(
        `${RU.devTools.successSeeded}: ${result.serviceItems} сущностей, ${result.odometerEntries} записей пробега, ${result.serviceEvents} событий`
      );
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : RU.devTools.statusError;
      setStatus(`${RU.devTools.statusError}: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSimulate = async (range: 'day' | 'week' | 'month') => {
    // Only allow simulation in TEST mode
    if (appMode !== AppMode.TEST) {
      setStatus(`${RU.devTools.statusError}: Симуляция доступна только в режиме тестирования`);
      return;
    }

    setIsLoading(true);
    setStatus(RU.devTools.statusRunning);
    try {
      // Pass current AppNow as base date for simulation
      const baseNowIso = getAppNow().toISOString();
      const result = await simulateTripRange(range, baseNowIso);
      
      // Update AppNow to the date of the inserted entry
      if (result.newAppNowIso) {
        setAppNow(result.newAppNowIso);
        const newAppNow = new Date(result.newAppNowIso);
        setAppNowState(newAppNow);
        setAppNowInput(toDateTimeLocalValue(newAppNow));
      }
      
      setStatus(
        `${RU.devTools.successSimulated}: +${result.totalIncrementKm} км за ${result.dayIncrement} дн., ${new Date(result.entry.occurred_at).toLocaleDateString('ru-RU')}`
      );
      // Re-render the current page once. No `?_t=` cache-buster: simulateTripRange() is a
      // server action that revalidates the affected paths, and this panel only ever renders
      // on Home, so the replace() was navigating to the page we are already on.
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : RU.devTools.statusError;
      setStatus(`${RU.devTools.statusError}: ${errorMessage}`);
      console.error('Simulate trip error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleWipe = async () => {
    setIsLoading(true);
    setStatus(RU.devTools.statusRunning);
    try {
      await wipeAllData();
      setStatus(RU.devTools.successWiped);
      setShowWipeConfirm(false);
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : RU.devTools.statusError;
      setStatus(`${RU.devTools.statusError}: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModeToggle = () => {
    const newMode = appMode === AppMode.TEST ? AppMode.LIVE : AppMode.TEST;
    try {
      setAppMode(newMode);
      setAppModeState(newMode);
      // Update AppNow display when switching to TEST mode
      if (newMode === AppMode.TEST) {
        const current = getAppNow();
        setAppNowState(current);
        setAppNowInput(toDateTimeLocalValue(current));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to set app mode';
      setStatus(`${RU.devTools.statusError}: ${errorMessage}`);
    }
  };

  const handleAppNowSetNow = () => {
    try {
      const now = new Date();
      setAppNow(now);
      setAppNowState(now);
      setAppNowInput(toDateTimeLocalValue(now));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to set AppNow';
      setStatus(`${RU.devTools.statusError}: ${errorMessage}`);
    }
  };

  const handleAppNowAdvance = (days: number) => {
    try {
      const advanced = advanceAppNow(days);
      setAppNowState(advanced);
      setAppNowInput(toDateTimeLocalValue(advanced));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to advance AppNow';
      setStatus(`${RU.devTools.statusError}: ${errorMessage}`);
    }
  };

  const handleAppNowReset = () => {
    try {
      resetAppNow();
      const now = new Date();
      setAppNowState(now);
      setAppNowInput(toDateTimeLocalValue(now));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reset AppNow';
      setStatus(`${RU.devTools.statusError}: ${errorMessage}`);
    }
  };

  const handleAppNowInputChange = (value: string) => {
    setAppNowInput(value);
  };

  const handleAppNowInputSubmit = () => {
    try {
      const date = fromDateTimeLocalValue(appNowInput);
      if (isNaN(date.getTime())) {
        setStatus(`${RU.devTools.statusError}: Неверная дата`);
        return;
      }
      setAppNow(date);
      setAppNowState(date);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to set AppNow';
      setStatus(`${RU.devTools.statusError}: ${errorMessage}`);
    }
  };

  const formatAppNow = (date: Date): string => {
    return date.toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <>
      <div ref={panelRef} className="dev-tools-panel">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="dev-tools-toggle"
        >
          {isOpen ? '▼' : '▲'} {RU.devTools.title}
        </button>
        
        {isOpen && (
          <div className="dev-tools-content">
            {/* App Mode Toggle */}
            <div className="dev-tools-mode-toggle">
              <div className="dev-tools-mode-toggle-row">
                <label htmlFor="app-mode-switch" className="dev-tools-mode-toggle-label">
                  Режим тестирования
                </label>
                <button
                  type="button"
                  id="app-mode-switch"
                  role="switch"
                  aria-checked={appMode === AppMode.TEST}
                  aria-label={appMode === AppMode.TEST ? 'Режим тестирования включен' : 'Режим тестирования выключен'}
                  onClick={handleModeToggle}
                  className={`dev-tools-mode-switch ${appMode === AppMode.TEST ? 'dev-tools-mode-switch-on' : ''}`}
                >
                  <span className="dev-tools-mode-switch-thumb" />
                </button>
              </div>
              <p className="dev-tools-mode-toggle-helper">
                Влияет только на поведение тестовых инструментов. В проде недоступно.
              </p>
            </div>

            {/* Test Clock UI - only visible in TEST mode */}
            {appMode === AppMode.TEST && (
              <div className="dev-tools-test-clock">
                <div className="dev-tools-test-clock-header">
                  <h3 className="dev-tools-test-clock-title">Тестовое время</h3>
                  <div className="dev-tools-test-clock-display">
                    {formatAppNow(appNow)}
                  </div>
                </div>

                <div className="dev-tools-test-clock-controls">
                  <button
                    type="button"
                    onClick={handleAppNowSetNow}
                    disabled={isLoading}
                    className="dev-tools-button"
                  >
                    Сейчас
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAppNowAdvance(1)}
                    disabled={isLoading}
                    className="dev-tools-button"
                  >
                    +1 день
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAppNowAdvance(7)}
                    disabled={isLoading}
                    className="dev-tools-button"
                  >
                    +7 дней
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAppNowAdvance(30)}
                    disabled={isLoading}
                    className="dev-tools-button"
                  >
                    +30 дней
                  </button>
                  <button
                    type="button"
                    onClick={handleAppNowReset}
                    disabled={isLoading}
                    className="dev-tools-button"
                  >
                    Сброс
                  </button>
                </div>

                <div className="dev-tools-test-clock-input">
                  <label htmlFor="app-now-input" className="dev-tools-test-clock-input-label">
                    Установить вручную:
                  </label>
                  <div className="dev-tools-test-clock-input-row">
                    <input
                      type="datetime-local"
                      id="app-now-input"
                      value={appNowInput}
                      onChange={(e) => handleAppNowInputChange(e.target.value)}
                      onBlur={handleAppNowInputSubmit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAppNowInputSubmit();
                        }
                      }}
                      className="dev-tools-test-clock-input-field"
                    />
                  </div>
                </div>

                <p className="dev-tools-test-clock-helper">
                  AppNow используется только в TEST режиме и влияет на симуляции. В LIVE режиме игнорируется.
                </p>
              </div>
            )}

            <div className="dev-tools-buttons">
              <button
                type="button"
                onClick={handleSeed}
                disabled={isLoading}
                className="dev-tools-button dev-tools-button-primary"
              >
                {RU.devTools.seedData}
              </button>
              {appMode === AppMode.TEST ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleSimulate('day')}
                    disabled={isLoading}
                    className="dev-tools-button"
                  >
                    {RU.devTools.simulateDay}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSimulate('week')}
                    disabled={isLoading}
                    className="dev-tools-button"
                  >
                    {RU.devTools.simulateWeek}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSimulate('month')}
                    disabled={isLoading}
                    className="dev-tools-button"
                  >
                    {RU.devTools.simulateMonth}
                  </button>
                </>
              ) : (
                <div className="dev-tools-simulation-disabled">
                  <p className="dev-tools-simulation-disabled-text">
                    Симуляция поездок доступна только в режиме тестирования. Переключите режим выше.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowWipeConfirm(true)}
                disabled={isLoading}
                className="dev-tools-button dev-tools-button-danger"
              >
                {RU.devTools.wipeAllData}
              </button>
            </div>
            
            {status && (
              <div className={`dev-tools-status ${status.includes(RU.devTools.statusError) ? 'error' : ''}`}>
                {status}
              </div>
            )}
          </div>
        )}
      </div>

      {showWipeConfirm && (
        <div className="add-mileage-form-container">
          <div className="add-mileage-form">
            <div className="form-header">
              <h2>{RU.devTools.wipeConfirmTitle}</h2>
              <button
                type="button"
                onClick={() => setShowWipeConfirm(false)}
                className="close-button"
                aria-label={RU.common.close}
                disabled={isLoading}
              >
                ×
              </button>
            </div>

            <div className="form-field">
              <p className="delete-confirm-message">{RU.devTools.wipeConfirmMessage}</p>
            </div>

            <div className="form-actions">
              <button
                type="button"
                onClick={() => setShowWipeConfirm(false)}
                disabled={isLoading}
                className="cancel-button"
              >
                {RU.devTools.wipeConfirmCancel}
              </button>
              <button
                type="button"
                onClick={handleWipe}
                disabled={isLoading}
                className="delete-button"
              >
                {isLoading ? RU.devTools.statusRunning : RU.devTools.wipeConfirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

