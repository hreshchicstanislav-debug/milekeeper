'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { seedDemoData, simulateTripRange, wipeAllData } from '@/lib/actions/devActions';
import { RU } from '@/lib/copy/ru';

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
  const router = useRouter();

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
    setIsLoading(true);
    setStatus(RU.devTools.statusRunning);
    try {
      const result = await simulateTripRange(range);
      setStatus(
        `${RU.devTools.successSimulated}: +${result.totalIncrementKm} км за ${result.dayIncrement} дн., ${new Date(result.entry.occurred_at).toLocaleDateString('ru-RU')}`
      );
      // Force page refresh to show updated mileage
      // Wait longer for server action to complete and cache invalidation to propagate
      await new Promise(resolve => setTimeout(resolve, 800));
      // Use router.replace with cache-busting parameter to force fresh data fetch
      router.replace(`/?_t=${Date.now()}`);
      // Also call refresh to ensure server components re-fetch
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
            <div className="dev-tools-buttons">
              <button
                type="button"
                onClick={handleSeed}
                disabled={isLoading}
                className="dev-tools-button dev-tools-button-primary"
              >
                {RU.devTools.seedData}
              </button>
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

