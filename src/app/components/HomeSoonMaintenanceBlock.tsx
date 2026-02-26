'use client';

import { useRouter } from 'next/navigation';
import { RU } from '@/lib/copy/ru';
import type { SoonMaintenanceItem } from '@/lib/home/soonMaintenance';
import type { ServiceItemStatusVM } from '@/lib/service/serviceItemStatusVM';
import { getAppMode, AppMode } from '@/lib/appMode';
import { getAppNow } from '@/lib/appNow';
import StatusRowCompact from './StatusRowCompact';
import { formatNumber } from '@/lib/copy/ru';
import type { OdometerEntry } from '@/lib/db/types';

interface SoonMaintenanceItemWithVM extends SoonMaintenanceItem {
  statusVM: ServiceItemStatusVM | null;
}

interface HomeSoonMaintenanceBlockProps {
  itemsWithVM: SoonMaintenanceItemWithVM[];
  dailyKmRate?: number;
  isFallbackRate?: boolean;
  windowDaysUsed?: number | null; // 14, 60, or null if fallback
  samplesUsed?: number; // Number of entries used in calculation
  fallbackReason?: string | null; // Reason for fallback, if applicable
  odometerEntries?: OdometerEntry[]; // For dev diagnostics
  latestEntry?: OdometerEntry | null; // For dev diagnostics
}

/**
 * Home "Soon Maintenance" block component
 * Renders iOS-style grouped list of maintenance items that need attention soon
 * Returns null if items array is empty (no empty surface)
 * 
 * Target UI (v1): Shows only title + statusText + progress-bar + color accent
 */
export default function HomeSoonMaintenanceBlock({ 
  itemsWithVM, 
  dailyKmRate, 
  isFallbackRate = false,
  windowDaysUsed = null,
  samplesUsed,
  fallbackReason,
  odometerEntries = [],
  latestEntry = null
}: HomeSoonMaintenanceBlockProps) {
  const router = useRouter();
  
  // Dev-only: Get app mode and AppNow for diagnostics
  const appMode = typeof window !== 'undefined' ? getAppMode() : AppMode.LIVE;
  // TO-BE: use single time source even in diagnostics
  const appNow = getAppNow();
  
  // Dev-only: Calculate diagnostic data
  const isDev = process.env.NODE_ENV !== 'production';
  let entriesWithin14d = 0;
  let entriesWithin60d = 0;
  
  if (isDev && odometerEntries.length > 0) {
    const cutoff14d = new Date(appNow.getTime() - 14 * 24 * 60 * 60 * 1000);
    const cutoff60d = new Date(appNow.getTime() - 60 * 24 * 60 * 60 * 1000);
    
    entriesWithin14d = odometerEntries.filter(entry => {
      const entryDate = new Date(entry.occurred_at);
      return entryDate >= cutoff14d && entryDate <= appNow;
    }).length;
    
    entriesWithin60d = odometerEntries.filter(entry => {
      const entryDate = new Date(entry.occurred_at);
      return entryDate >= cutoff60d && entryDate <= appNow;
    }).length;
  }
  
  // IMPORTANT: Return null if no items (no empty surface)
  if (itemsWithVM.length === 0) {
    return null;
  }

  // Filter out items without statusVM (should not happen in practice)
  const validItems = itemsWithVM.filter(item => item.statusVM !== null);
  if (validItems.length === 0) {
    return null;
  }

  // Check if there are any km-mode items to show rate hint
  const hasKmItems = validItems.some(item => !item.isCalendarMode);
  const showRateHint = hasKmItems && dailyKmRate !== undefined;

  /**
   * Map statusVM to semantic category for Home-only lightweight indicator
   * Rules:
   * - If daysToReplace < 0 => category='critical'
   * - Else if daysToReplace is null and prediction is unreliable => category='warning_unknown'
   * - Else if daysToReplace <= 10 => category='warning'
   * - Else category='ok'
   */
  const getCategory = (statusVM: ServiceItemStatusVM): 'critical' | 'warning' | 'warning_unknown' | 'ok' => {
    if (statusVM.daysToReplace !== null && statusVM.daysToReplace < 0) {
      return 'critical';
    }
    
    if (statusVM.daysToReplace === null && !statusVM.isPredictionReliable) {
      return 'warning_unknown';
    }
    
    if (statusVM.daysToReplace !== null && statusVM.daysToReplace <= 10) {
      return 'warning';
    }
    
    return 'ok';
  };

  return (
    <section className="soon-maintenance-section home-soon-maintenance">
      <h2 className="soon-maintenance-title">{RU.home.soonMaintenance.title}</h2>
      {showRateHint && (
        <>
          <div className="soon-maintenance-rate-hint">
            {isFallbackRate || !windowDaysUsed ? (
              // Fallback: show approximate rate without window claim
              <>Средний пробег: ~{formatNumber(Math.round(dailyKmRate!))} км/день (примерно)</>
            ) : (
              // Success: show rate with window label
              <>Средний пробег за последние {windowDaysUsed} дней: ~{formatNumber(Math.round(dailyKmRate!))} км/день</>
            )}
          </div>
          
          {/* Dev-only diagnostics */}
          {isDev && (
            <div style={{ 
              fontSize: '0.75rem', 
              color: 'rgba(0, 0, 0, 0.5)', 
              padding: 'var(--sp-2, 0.5rem)',
              backgroundColor: 'rgba(0, 0, 0, 0.02)',
              borderRadius: 'var(--radius-sm, 8px)',
              marginTop: 'var(--sp-2, 0.5rem)',
              fontFamily: 'monospace'
            }}>
              <div><strong>AppMode:</strong> {appMode}</div>
              <div><strong>AppNow:</strong> {appNow.toISOString()}</div>
              <div><strong>Daily Rate:</strong> windowDaysUsed={windowDaysUsed ?? 'null'}, samplesUsed={samplesUsed ?? '?'}, isFallback={isFallbackRate ? 'true' : 'false'}{fallbackReason ? `, reason="${fallbackReason}"` : ''}</div>
              <div><strong>Odometer Window:</strong> entriesWithin14d={entriesWithin14d}, entriesWithin60d={entriesWithin60d}</div>
              {latestEntry && (
                <div><strong>Latest Entry:</strong> occurred_at={latestEntry.occurred_at}, mileage_km={latestEntry.mileage_km}</div>
              )}
            </div>
          )}
        </>
      )}
      <div className="soon-maintenance-group">
        <div className="soon-maintenance-list">
          {validItems.map((item, index) => {
            const statusVM = item.statusVM!; // Guaranteed by filter above
            const category = getCategory(statusVM);

            return (
              <div
                key={item.id}
                className={`soon-maintenance-row clickable ${index === validItems.length - 1 ? 'last' : ''}`}
                onClick={() => {
                  // Navigate to item details page
                  router.push(`/items/${item.id}`);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/items/${item.id}`);
                  }
                }}
              >
                <div className="soon-maintenance-row-content">
                  <StatusRowCompact
                    title={item.title}
                    statusText={statusVM.statusText}
                    category={category}
                    isPredictionReliable={statusVM.isPredictionReliable}
                    className="soon-maintenance-status-content"
                  />
                  {/* Dev-only: per-row diagnostics */}
                  {isDev && (
                    <div style={{
                      fontSize: '0.6875rem',
                      color: 'rgba(0, 0, 0, 0.4)',
                      marginTop: 'var(--sp-1, 0.25rem)',
                      fontFamily: 'monospace'
                    }}>
                      statusText="{statusVM.statusText}", daysToReplace={statusVM.daysToReplace ?? 'null'}, isPredictionReliable={statusVM.isPredictionReliable ? 'true' : 'false'}
                      {!statusVM.isPredictionReliable && (
                        <span style={{ color: 'rgba(255, 0, 0, 0.6)' }}>
                          {' '}(unreliable: {isFallbackRate ? 'isFallbackRate' : ''}{dailyKmRate === 30 ? 'dailyKmRate=30' : ''})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

