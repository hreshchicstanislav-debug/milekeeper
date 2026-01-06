'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import AddServiceItemForm from '../components/AddServiceItemForm';
import ItemDetailsSheet from '../components/ItemDetailsSheet';
import StatusRow from '../components/StatusRow';
import { RU, formatNumber } from '@/lib/copy/ru';
import type { ServiceItem } from '@/lib/db/types';
import type { ServiceItemStatusVM } from '@/lib/service/serviceItemStatusVM';

interface ItemsPageClientProps {
  itemsWithLastEvent: Array<{ item: ServiceItem; lastEvent: any; statusVM: ServiceItemStatusVM }>;
  latestOdometer: any;
  dailyKmRate?: number | null;
}

export default function ItemsPageClient({ itemsWithLastEvent, latestOdometer, dailyKmRate = null }: ItemsPageClientProps) {
  const [selectedItemForDetails, setSelectedItemForDetails] = useState<ServiceItem | null>(null);
  const [editingItem, setEditingItem] = useState<ServiceItem | null>(null);
  const [pendingDetailsItemId, setPendingDetailsItemId] = useState<string | null>(null);
  const router = useRouter();
  const hasMountedRef = useRef(false);
  const refreshCountRef = useRef(0);
  const savedScrollPositionRef = useRef<number>(0);

  // Dev-only: log mount once
  useEffect(() => {
    if (!hasMountedRef.current && process.env.NODE_ENV !== 'production') {
      hasMountedRef.current = true;
      console.log('[ItemsPageClient] Mounted');
    }
  }, []);


  // Dev-only: log refresh calls
  const handleRefresh = () => {
    if (process.env.NODE_ENV !== 'production') {
      refreshCountRef.current += 1;
      console.log(`[ItemsPageClient] Refresh called (count: ${refreshCountRef.current})`);
    }
    // Save scroll position before refresh
    savedScrollPositionRef.current = window.scrollY || document.documentElement.scrollTop;
    router.refresh();
    // Restore scroll position after refresh (use setTimeout to ensure DOM is updated)
    setTimeout(() => {
      window.scrollTo(0, savedScrollPositionRef.current);
    }, 0);
  };

  // Open Item Details Sheet after data refresh (when pendingDetailsItemId is set)
  useEffect(() => {
    if (pendingDetailsItemId) {
      const itemToShow = itemsWithLastEvent.find(({ item }) => item.id === pendingDetailsItemId)?.item;
      if (itemToShow) {
        // Save scroll position before opening (will be restored on close)
        savedScrollPositionRef.current = window.scrollY || document.documentElement.scrollTop;
        setSelectedItemForDetails(itemToShow);
        setPendingDetailsItemId(null);
      }
    }
  }, [itemsWithLastEvent, pendingDetailsItemId]);

  return (
    <>
      <header className="page-header">
        <h1>{RU.items.title}</h1>
      </header>
      <div className="page-content">
        {itemsWithLastEvent.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-message">{RU.items.emptyMessage}</p>
          </div>
        ) : (
          <div className="items-list-group">
            <div className="items-list">
              {itemsWithLastEvent.map(({ item, statusVM }, index) => (
                <div 
                  key={item.id} 
                  className={`service-item-row clickable status-accent status-${statusVM.statusColor} ${index === itemsWithLastEvent.length - 1 ? 'last' : ''}`}
                  onClick={() => {
                    // Navigate to item details page (mobile-first approach)
                    router.push(`/items/${item.id}`);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      // Navigate to item details page
                      router.push(`/items/${item.id}`);
                    }
                  }}
                >
                  <div className="service-item-row-content">
                    <StatusRow
                      title={item.title}
                      statusText={statusVM.statusText}
                      statusColor={statusVM.statusColor}
                      remainingRatio={statusVM.remainingRatio}
                      isPredictionReliable={statusVM.isPredictionReliable}
                      className="service-item-status-content"
                    />
                  </div>
                  <span className="row-chevron" aria-hidden="true">›</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="add-item-section">
          <AddServiceItemForm />
        </div>
      </div>

      {/* Details sheet (history view) */}
      {selectedItemForDetails && !editingItem && (() => {
        // Find lastEvent for selected item
        const itemData = itemsWithLastEvent.find(({ item }) => item.id === selectedItemForDetails.id);
        const lastEvent = itemData?.lastEvent || null;
        
        return (
          <ItemDetailsSheet
            item={selectedItemForDetails}
            latestOdometer={latestOdometer}
            lastEvent={lastEvent}
            dailyKmRate={dailyKmRate}
            onClose={() => {
              setSelectedItemForDetails(null);
              // Restore scroll position after closing sheet
              requestAnimationFrame(() => {
                window.scrollTo(0, savedScrollPositionRef.current);
              });
            }}
            onOpenSettings={(item) => {
              // Save the item ID for potential return to details after edit
              // Don't restore scroll position here - we may return to details sheet
              setSelectedItemForDetails(null);
              setEditingItem(item);
            }}
            onRefresh={handleRefresh}
          />
        );
      })()}

      {/* Edit form modal (opened from Details sheet) */}
      {editingItem && (
        <div className="modal-overlay" onClick={() => setEditingItem(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <AddServiceItemForm
              mode="edit"
              initialItem={editingItem}
              onClose={() => setEditingItem(null)}
              onSuccess={handleRefresh}
              onReturnToDetails={(itemId) => {
                // Close edit form
                setEditingItem(null);
                // Set pending item ID - Item Details Sheet will open after data refresh completes
                // router.refresh() was already called in onSuccess, so data is being updated
                // useEffect will open Details Sheet when itemsWithLastEvent is updated with fresh data
                setPendingDetailsItemId(itemId);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

