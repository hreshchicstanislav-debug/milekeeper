'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { addServiceEvent } from '@/lib/actions/serviceActions';
import { RU } from '@/lib/copy/ru';
import { formatMileageInput, parseMileageInput, trimWhitespace } from '@/lib/utils/numberFormat';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from '@/lib/time/datetimeLocal';
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
        // Only allow swipe if at the very top of scrollable content
        if (scrollable.scrollTop > 5) {
          return; // User is scrolling content, don't start swipe
        }
        // Check if content is actually scrollable
        if (scrollable.scrollHeight > scrollable.clientHeight + 5) {
          // Content is scrollable, only allow swipe from top
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

interface AddServiceEventFormProps {
  serviceItemId: string;
  serviceItemTitle: string;
  defaultMileage?: number | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AddServiceEventForm({
  serviceItemId,
  serviceItemTitle,
  defaultMileage,
  isOpen,
  onClose,
  onSuccess,
}: AddServiceEventFormProps) {
  const [mileageKm, setMileageKm] = useState(
    defaultMileage ? formatMileageInput(String(defaultMileage)) : ''
  );
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocalValue(new Date()));
  const [showDate, setShowDate] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const mileageInputRef = useRef<HTMLInputElement>(null);
  const hasRefreshedRef = useRef(false); // Guard to prevent multiple refreshes
  const formRef = useRef<HTMLFormElement>(null);

  // Swipe-to-close gesture
  useSwipeToClose<HTMLFormElement>(formRef, onClose, isOpen);

  // Lock body scroll and register modal when form is open (using refcount manager)
  useEffect(() => {
    if (isOpen) {
      lockScroll('AddServiceEventForm');
      modalOpened('AddServiceEventForm');
      return () => {
        unlockScroll('AddServiceEventForm');
        modalClosed('AddServiceEventForm');
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      // Сбрасываем форму при открытии
      setMileageKm(defaultMileage ? formatMileageInput(String(defaultMileage)) : '');
      setNote('');
      setOccurredAt(toDateTimeLocalValue(new Date()));
      setShowDate(false);
      setShowNote(false);
      setError(null);
      // Reset refresh guard when form opens
      hasRefreshedRef.current = false;
      // Фокус на поле пробега
      setTimeout(() => mileageInputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultMileage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const mileage = parseMileageInput(mileageKm);
    
    if (mileage === null || mileage <= 0) {
      if (!mileageKm.trim()) {
        setError(RU.items.serviceEvent.errorMileageRequired);
      } else {
        setError(RU.items.serviceEvent.errorMileageInvalid);
      }
      setIsSubmitting(false);
      return;
    }

    try {
      await addServiceEvent({
        serviceItemId,
        occurredAt: fromDateTimeLocalValue(occurredAt),
        mileageKm: mileage,
        note: note ? trimWhitespace(note) : null,
      });

      // Success: reset form
      setMileageKm(defaultMileage ? formatMileageInput(String(defaultMileage)) : '');
      setNote('');
      setOccurredAt(toDateTimeLocalValue(new Date()));
      setShowDate(false);
      setShowNote(false);
      
      // Call onSuccess BEFORE closing (to ensure toast/close actions happen before unmount)
      // Refresh only once after successful action (hasRefreshedRef guard prevents double refresh)
      if (!hasRefreshedRef.current) {
        hasRefreshedRef.current = true;
        // Call onSuccess first (e.g., to show toast and close parent sheet)
        // onSuccess may also call handleRefresh() which may trigger router.refresh(),
        // but we still need to refresh here to ensure all pages update
        if (onSuccess) {
          onSuccess();
        }
        // Refresh router to update all pages (Home, /items list, etc.)
        // Add cache-busting to ensure fresh data on Vercel
        const url = new URL(window.location.href);
        url.searchParams.set('_t', Date.now().toString());
        router.replace(url.pathname + url.search, { scroll: false });
        router.refresh();
      }
      
      // Close form after success callback
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : RU.items.serviceEvent.errorFailedToAdd;
      // Переводим известные ошибки с сервера
      if (errorMessage.includes('Service mileage cannot be less') || errorMessage.includes('less than latest odometer')) {
        setError(RU.items.serviceEvent.errorMileageTooLow);
      } else if (errorMessage.includes('Mileage required')) {
        setError(RU.items.serviceEvent.errorMileageRequired);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setMileageKm(defaultMileage ? formatMileageInput(String(defaultMileage)) : '');
    setNote('');
    setError(null);
    setShowDate(false);
    setShowNote(false);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="add-mileage-form-container">
      <form ref={formRef} onSubmit={handleSubmit} className="add-mileage-form">
        <div className="form-header">
          {/* Grabber bar - iOS style */}
          <div className="sheet-grabber" />
          
          <div className="form-header-content">
            <h2>{RU.items.serviceEvent.formTitle}: {serviceItemTitle}</h2>
            <button
              type="button"
              onClick={handleCancel}
              className="close-button"
              aria-label={RU.common.close}
            >
              ×
            </button>
          </div>
        </div>

        <div className="form-content">
          {error && <div className="error-message">{error}</div>}

          <div className="form-field">
            <label htmlFor="serviceEventMileageKm">{RU.items.serviceEvent.mileageLabel}</label>
            <input
              ref={mileageInputRef}
              id="serviceEventMileageKm"
              type="text"
              inputMode="numeric"
              pattern="[0-9\s]*"
              value={mileageKm}
              onChange={(e) => setMileageKm(formatMileageInput(e.target.value))}
              required
              disabled={isSubmitting}
              placeholder={RU.items.serviceEvent.mileagePlaceholder}
              className="mileage-input"
            />
          </div>

          <div className="form-field">
            <button
              type="button"
              onClick={() => setShowDate(!showDate)}
              className="toggle-button"
            >
              {showDate ? '✓' : '○'} {RU.items.serviceEvent.changeDate}
            </button>
            {showDate && (
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                disabled={isSubmitting}
                className="date-input"
              />
            )}
          </div>

          <div className="form-field">
            <button
              type="button"
              onClick={() => setShowNote(!showNote)}
              className="toggle-button"
            >
              {showNote ? '✓' : '○'} {RU.items.serviceEvent.noteLabel}
            </button>
            {showNote && (
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isSubmitting}
                placeholder={RU.items.serviceEvent.notePlaceholder}
                rows={3}
                className="note-input"
              />
            )}
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="cancel-button"
          >
            {RU.items.serviceEvent.cancel}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !mileageKm}
            className="submit-button"
          >
            {isSubmitting ? RU.items.serviceEvent.saving : RU.items.serviceEvent.save}
          </button>
        </div>
      </form>
    </div>
  );
}

