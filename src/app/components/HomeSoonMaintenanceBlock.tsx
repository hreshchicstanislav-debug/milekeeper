'use client';

import { useRouter } from 'next/navigation';
import { RU } from '@/lib/copy/ru';
import type { SoonMaintenanceItem } from '@/lib/home/soonMaintenance';
import type { ServiceItemStatusVM } from '@/lib/service/serviceItemStatusVM';
import StatusRowCompact from './StatusRowCompact';
import { formatNumber } from '@/lib/copy/ru';

interface SoonMaintenanceItemWithVM extends SoonMaintenanceItem {
  statusVM: ServiceItemStatusVM | null;
}

interface HomeSoonMaintenanceBlockProps {
  itemsWithVM: SoonMaintenanceItemWithVM[];
  dailyKmRate?: number;
  isFallbackRate?: boolean;
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
  isFallbackRate = false 
}: HomeSoonMaintenanceBlockProps) {
  const router = useRouter();
  
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
   * - If statusText is 'Просрочено' OR daysToReplace < 0 => category='critical'
   * - Else if statusText is 'Скоро' AND isPredictionReliable=false => category='warning_unknown'
   * - Else if statusText includes 'дн' or '~' and daysToReplace is not null:
   *   - if daysToReplace <= 10 => category='warning'
   *   - else category='ok'
   */
  const getCategory = (statusVM: ServiceItemStatusVM): 'critical' | 'warning' | 'warning_unknown' | 'ok' => {
    if (statusVM.statusText === 'Просрочено' || (statusVM.daysToReplace !== null && statusVM.daysToReplace < 0)) {
      return 'critical';
    }
    
    if (statusVM.statusText === 'Скоро' && !statusVM.isPredictionReliable) {
      return 'warning_unknown';
    }
    
    if ((statusVM.statusText.includes('дн') || statusVM.statusText.includes('~')) && statusVM.daysToReplace !== null) {
      if (statusVM.daysToReplace <= 10) {
        return 'warning';
      }
      return 'ok';
    }
    
    // Default fallback
    return 'ok';
  };

  return (
    <section className="soon-maintenance-section home-soon-maintenance">
      <h2 className="soon-maintenance-title">{RU.home.soonMaintenance.title}</h2>
      {showRateHint && (
        <div className="soon-maintenance-rate-hint">
          Темп: ~{formatNumber(Math.round(dailyKmRate!))} км/день{isFallbackRate ? ' (примерно)' : ''}
        </div>
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
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

