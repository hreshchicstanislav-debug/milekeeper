'use client';

import { useRouter } from 'next/navigation';
import { RU } from '@/lib/copy/ru';
import type { SoonMaintenanceItem } from '@/lib/home/soonMaintenance';
import type { ServiceItemStatusVM } from '@/lib/service/serviceItemStatusVM';
import StatusRow from './StatusRow';
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

  return (
    <section className="soon-maintenance-section">
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

            return (
              <div
                key={item.id}
                className={`soon-maintenance-row clickable status-accent status-${statusVM.statusColor} ${index === validItems.length - 1 ? 'last' : ''}`}
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
                  <StatusRow
                    title={item.title}
                    statusText={statusVM.statusText}
                    statusColor={statusVM.statusColor}
                    remainingRatio={statusVM.remainingRatio}
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

