'use client';

import { RU } from '@/lib/copy/ru';
import type { SoonMaintenanceItem } from '@/lib/home/soonMaintenance';

interface HomeSoonMaintenanceBlockProps {
  items: SoonMaintenanceItem[];
}

/**
 * Home "Soon Maintenance" block component
 * Renders iOS-style grouped list of maintenance items that need attention soon
 * Returns null if items array is empty (no empty surface)
 */
export default function HomeSoonMaintenanceBlock({ items }: HomeSoonMaintenanceBlockProps) {
  // IMPORTANT: Return null if no items (no empty surface)
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="soon-maintenance-section">
      <h2 className="soon-maintenance-title">{RU.home.soonMaintenance.title}</h2>
      <div className="soon-maintenance-group">
        <div className="soon-maintenance-list">
          {items.map((item, index) => (
            <div
              key={item.id}
              className={`soon-maintenance-row ${item.severity === 'OVERDUE' ? 'overdue' : ''} ${index === items.length - 1 ? 'last' : ''}`}
            >
              <div className="soon-maintenance-row-main">
                <span className="soon-maintenance-row-title" title={item.title}>
                  {item.title}
                </span>
                <div className="soon-maintenance-right">
                  {item.eta && (
                    <span className="soon-maintenance-eta">{item.eta}</span>
                  )}
                  {item.statusLabel && (
                    <span className="soon-maintenance-status">{item.statusLabel}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

