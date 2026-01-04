'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createServiceItem, updateServiceItem, deleteServiceItem } from '@/lib/actions/serviceActions';
import { RU } from '@/lib/copy/ru';
import { formatMileageInput, parseMileageInput, trimWhitespace } from '@/lib/utils/numberFormat';
import type { ServiceItem } from '@/lib/db/types';
import WheelPicker from './WheelPicker';

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
      const scrollable = target.closest('.form-content');
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
      if (!isDraggingRef.current || startYRef.current === null) return;
      
      const target = e.target as HTMLElement;
      const scrollEl = target.closest('.form-content') as HTMLElement | null;
      
      // If touch is on scrollable content, check if user is trying to scroll
      if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 1) {
        const deltaY = e.touches[0].clientY - startYRef.current;
        const atTop = scrollEl.scrollTop <= 0;
        const atBottom = scrollEl.scrollTop >= scrollEl.scrollHeight - scrollEl.clientHeight - 1;
        
        // If user is attempting to scroll content, DO NOT preventDefault
        // Allow scroll in any direction when not at boundaries, or when scrolling within content
        if (!atTop && deltaY > 0) {
          // Scrolling down within content - allow native scroll
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
        if (!atBottom && deltaY < 0) {
          // Scrolling up within content - allow native scroll
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
        if (atTop && deltaY < 0) {
          // Scrolling up while at top - allow native scroll
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
        if (atBottom && deltaY > 0) {
          // Scrolling down while at bottom - allow native scroll
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
        
        // Only allow sheet-drag/swipe-to-close when: at top, dragging down, with threshold
        const DRAG_THRESHOLD = 10;
        if (atTop && deltaY > DRAG_THRESHOLD && scrollEl.scrollTop === 0) {
          // This is a clear drag gesture for swipe-to-close
          e.preventDefault();
          handleMove(e.touches[0].clientY);
          return;
        }
        
        // If at top but small movement, likely scroll attempt - don't preventDefault
        if (atTop && Math.abs(deltaY) <= DRAG_THRESHOLD) {
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
      }
      
      // If scrollEl doesn't exist (touch on header/grabber/outside content), allow drag
      e.preventDefault();
      handleMove(e.touches[0].clientY);
    };

    const handleTouchEnd = () => {
      handleEnd();
    };

    // Pointer events (for mouse support)
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return; // Only handle touch
      const target = e.target as HTMLElement;
      const scrollable = target.closest('.form-content');
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
      if (!isDraggingRef.current || e.pointerType === 'mouse' || startYRef.current === null) return;
      
      const target = e.target as HTMLElement;
      const scrollEl = target.closest('.form-content') as HTMLElement | null;
      
      // If touch is on scrollable content, check if user is trying to scroll
      if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 1) {
        const deltaY = e.clientY - startYRef.current;
        const atTop = scrollEl.scrollTop <= 0;
        const atBottom = scrollEl.scrollTop >= scrollEl.scrollHeight - scrollEl.clientHeight - 1;
        
        // If user is attempting to scroll content, DO NOT preventDefault
        if (!atTop && deltaY > 0) {
          // Scrolling down within content - allow native scroll
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          startTimeRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
        if (!atBottom && deltaY < 0) {
          // Scrolling up within content - allow native scroll
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          startTimeRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
        if (atTop && deltaY < 0) {
          // Scrolling up while at top - allow native scroll
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          startTimeRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
        if (atBottom && deltaY > 0) {
          // Scrolling down while at bottom - allow native scroll
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          startTimeRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
        
        // Only allow sheet-drag/swipe-to-close when: at top, dragging down, with threshold
        const DRAG_THRESHOLD = 10;
        if (atTop && deltaY > DRAG_THRESHOLD && scrollEl.scrollTop === 0) {
          // This is a clear drag gesture for swipe-to-close
          e.preventDefault();
          handleMove(e.clientY);
          return;
        }
        
        // If at top but small movement, likely scroll attempt - don't preventDefault
        if (atTop && Math.abs(deltaY) <= DRAG_THRESHOLD) {
          isDraggingRef.current = false;
          startYRef.current = null;
          currentYRef.current = null;
          startTimeRef.current = null;
          element.style.transition = '';
          element.style.transform = '';
          return;
        }
      }
      
      // If scrollEl doesn't exist (touch on header/grabber/outside content), allow drag
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

interface AddServiceItemFormProps {
  mode?: 'create' | 'edit';
  initialItem?: ServiceItem;
  onClose?: () => void;
  onSuccess?: () => void; // Callback after successful save/delete
  onReturnToDetails?: (itemId: string) => void; // Callback to return to Item Details Sheet after edit (only for edit-from-details flow)
}

export default function AddServiceItemForm({ 
  mode = 'create', 
  initialItem,
  onClose,
  onSuccess,
  onReturnToDetails
}: AddServiceItemFormProps = {}) {
  const [isOpen, setIsOpen] = useState(mode === 'edit');
  const [title, setTitle] = useState(initialItem?.title || '');
  const [measurementMode, setMeasurementMode] = useState<'km' | 'calendar'>(
    initialItem?.measurement_mode || 'km'
  );
  const [intervalKm, setIntervalKm] = useState(initialItem?.interval_km ? formatMileageInput(String(initialItem.interval_km)) : '');
  const [intervalDays, setIntervalDays] = useState(initialItem?.interval_days ? String(initialItem.interval_days) : '');
  // Y/M/D picker state for calendar mode
  const [intervalYears, setIntervalYears] = useState(0);
  const [intervalMonths, setIntervalMonths] = useState(0);
  const [intervalDaysParts, setIntervalDaysParts] = useState(0);
  const [notifyBeforeDays, setNotifyBeforeDays] = useState(initialItem?.notify_before_days ? String(initialItem.notify_before_days) : (mode === 'create' ? '30' : ''));
  
  // Helper: convert Y/M/D parts to interval_days
  const ymdToDays = (years: number, months: number, days: number): number => {
    return years * 365 + months * 30 + days;
  };
  
  // Handle measurement mode change: clear the hidden interval field
  const handleMeasurementModeChange = (newMode: 'km' | 'calendar') => {
    setMeasurementMode(newMode);
    // Clear the hidden interval field when switching modes
    if (newMode === 'km') {
      setIntervalDays(''); // Clear days when switching to km mode
    } else {
      setIntervalKm(''); // Clear km when switching to calendar mode
    }
  };
  const [note, setNote] = useState(initialItem?.note || '');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const router = useRouter();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const hasRefreshedRef = useRef(false); // Guard to prevent multiple refreshes
  const formRef = useRef<HTMLFormElement>(null);
  const deleteConfirmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      titleInputRef.current.focus();
    }
    // Reset refresh guard when form opens/closes or item changes
    hasRefreshedRef.current = false;
  }, [isOpen, initialItem?.id, mode]);

  // Update form when initialItem changes (for edit mode)
  useEffect(() => {
    if (initialItem && mode === 'edit') {
      setTitle(initialItem.title || '');
      const itemMode = initialItem.measurement_mode || 'km';
      setMeasurementMode(itemMode);
      // Set intervals based on mode
      if (itemMode === 'km') {
        setIntervalKm(initialItem.interval_km ? formatMileageInput(String(initialItem.interval_km)) : '');
        setIntervalDays(''); // Clear days for km mode
      } else {
        // Calendar mode: decompose interval_days into Y/M/D parts
        if (initialItem.interval_days !== null) {
          const totalDays = initialItem.interval_days;
          const years = Math.floor(totalDays / 365);
          const remainingAfterYears = totalDays % 365;
          const months = Math.floor(remainingAfterYears / 30);
          const days = remainingAfterYears % 30;
          setIntervalYears(years);
          setIntervalMonths(months);
          setIntervalDaysParts(days);
        } else {
          setIntervalYears(0);
          setIntervalMonths(0);
          setIntervalDaysParts(0);
        }
        setIntervalDays(''); // Keep for backward compatibility but not used in UI
        setIntervalKm(''); // Clear km for calendar mode
      }
      setNotifyBeforeDays(initialItem.notify_before_days ? String(initialItem.notify_before_days) : '');
      setNote(initialItem.note || '');
    }
  }, [initialItem, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    // Валидация: название обязательно
    if (!title.trim()) {
      setError(RU.items.errorTitleRequired);
      setIsSubmitting(false);
      return;
    }

    // Валидация: интервал обязателен в зависимости от режима
    const kmValue = intervalKm.trim() ? parseMileageInput(intervalKm) : null;
    
    // For calendar mode: calculate totalDays from Y/M/D parts
    let daysValue: number | null = null;
    if (measurementMode === 'calendar') {
      const totalDays = ymdToDays(intervalYears, intervalMonths, intervalDaysParts);
      daysValue = totalDays > 0 ? totalDays : null;
    } else {
      // For km mode: use old intervalDays input (if any, but should be empty)
      daysValue = intervalDays.trim() ? parseInt(intervalDays.trim(), 10) : null;
    }

    if (measurementMode === 'km') {
      // Для режима km: intervalKm обязателен
      if (!kmValue || kmValue <= 0) {
        setError(RU.items.intervalKmRequired);
        setIsSubmitting(false);
        return;
      }
    } else if (measurementMode === 'calendar') {
      // Для режима calendar: totalDays from Y/M/D parts обязателен и > 0
      if (!daysValue || daysValue <= 0) {
        setError(RU.items.intervalDaysRequired);
        setIsSubmitting(false);
        return;
      }
    }

    // Валидация: интервалы должны быть положительными числами (если указаны)
    if (kmValue !== null && kmValue <= 0) {
      setError(RU.items.errorInvalidInterval);
      setIsSubmitting(false);
      return;
    }

    if (daysValue !== null && (isNaN(daysValue) || daysValue <= 0)) {
      setError(RU.items.errorInvalidInterval);
      setIsSubmitting(false);
      return;
    }

    // Валидация: notifyBeforeDays обязателен
    const notifyDaysValue = notifyBeforeDays.trim() ? parseInt(notifyBeforeDays.trim(), 10) : null;

    if (!notifyDaysValue || isNaN(notifyDaysValue) || notifyDaysValue <= 0) {
      setError(RU.items.errorNotifyBeforeDaysRequired);
      setIsSubmitting(false);
      return;
    }

    // Валидация: максимальное значение 365 дней
    if (notifyDaysValue > 365) {
      setError('Поле «Уведомлять за, дней» не должно превышать 365 дней');
      setIsSubmitting(false);
      return;
    }

    try {
      // Prepare interval values: send null for hidden field
      const finalIntervalKm = measurementMode === 'km' ? kmValue : null;
      const finalIntervalDays = measurementMode === 'calendar' ? daysValue : null;

      // Use measurementMode from state (explicit user choice, no auto-detection)
      if (mode === 'edit' && initialItem) {
        // Update existing item
        await updateServiceItem(initialItem.id, {
          title: trimWhitespace(title),
          intervalKm: finalIntervalKm,
          intervalDays: finalIntervalDays,
          notifyBeforeDays: notifyDaysValue,
          notifyBeforeKm: null, // Always null (removed from UI)
          measurementMode,
          note: note ? trimWhitespace(note) : null,
        });
      } else {
        // Create new item
        await createServiceItem({
          title: trimWhitespace(title),
          intervalKm: finalIntervalKm,
          intervalDays: finalIntervalDays,
          notifyBeforeDays: notifyDaysValue,
          notifyBeforeKm: null, // Always null (removed from UI)
          measurementMode,
          note: note ? trimWhitespace(note) : null,
        });
      }

      // Success: show success message, refresh, then auto-close form
      setError(null);
      setSuccessMessage(mode === 'edit' ? RU.items.successSaved : RU.items.successSaved);
      
      // Refresh only once after successful action
      if (!hasRefreshedRef.current) {
        hasRefreshedRef.current = true;
        await router.refresh();
        if (onSuccess) onSuccess();
      }
      
      // Auto-close form after showing success message (800ms delay)
      setTimeout(() => {
        // Reset form and close
        setTitle('');
        setMeasurementMode('km');
        setIntervalKm('');
        setIntervalDays('');
        setNotifyBeforeDays(mode === 'create' ? '30' : '');
        setNote('');
        setSuccessMessage(null);
        setIsOpen(false);
        
        // If edit mode and onReturnToDetails is provided, return to Item Details Sheet
        if (mode === 'edit' && initialItem && onReturnToDetails) {
          onReturnToDetails(initialItem.id);
        } else {
          // Otherwise, use standard close behavior
          if (onClose) onClose();
        }
      }, 800);
    } catch (err) {
      setSuccessMessage(null); // Clear success message on error
      const errorMessage = err instanceof Error ? err.message : (mode === 'edit' ? RU.items.errorUpdateFailed : RU.items.errorFailedToAdd);
      // Map known errors to RU strings
      if (errorMessage.includes('At least one interval') || errorMessage.includes('хотя бы один интервал')) {
        setError(RU.items.errorIntervalRequired);
      } else if (errorMessage.includes('Название обязательно') || errorMessage.includes('title')) {
        setError(RU.items.errorTitleRequired);
      } else if (errorMessage.includes('положительным числом') || errorMessage.includes('positive')) {
        setError(RU.items.errorInvalidInterval);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!initialItem || mode !== 'edit') return;

    setIsSubmitting(true);
    setError(null);

    try {
      await deleteServiceItem(initialItem.id);
      
      // Refresh only once after successful deletion
      if (!hasRefreshedRef.current) {
        hasRefreshedRef.current = true;
        await router.refresh();
        if (onSuccess) onSuccess();
      }
      
      // Close form AFTER refresh
      setIsOpen(false);
      if (onClose) onClose();
      setShowDeleteConfirm(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : RU.items.errorDeleteFailed;
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (mode === 'create') {
      setTitle('');
      setMeasurementMode('km');
      setIntervalKm('');
      setIntervalDays('');
      setNotifyBeforeDays('30');
      setNote('');
    }
    setError(null);
    setSuccessMessage(null);
    if (onClose) onClose();
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  // Swipe-to-close gesture for main form
  useSwipeToClose<HTMLFormElement>(formRef, handleCancel, isOpen && !showDeleteConfirm);

  // Swipe-to-close gesture for delete confirmation
  useSwipeToClose<HTMLDivElement>(deleteConfirmRef, handleDeleteCancel, isOpen && showDeleteConfirm);

  if (!isOpen && mode === 'create') {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="add-mileage-button"
      >
        {RU.items.addItem}
      </button>
    );
  }

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
            <h2>{mode === 'edit' ? RU.items.editTitle : RU.items.formTitle}</h2>
            <button
              type="button"
              onClick={handleCancel}
              className="close-button"
              aria-label={RU.common.close}
              disabled={isSubmitting}
            >
              ×
            </button>
          </div>
        </div>

        <div className="form-content">
          {error && <div className="error-message">{error}</div>}
          {successMessage && <div className="success-message">{successMessage}</div>}

          <div className="form-field">
          <label htmlFor="title">{RU.items.titleLabel}</label>
          <input
            ref={titleInputRef}
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={isSubmitting}
            placeholder={RU.items.titlePlaceholder}
            className="mileage-input"
          />
        </div>

        <div className="form-field">
          <label>{RU.items.measurementModeLabel}</label>
          <div className="segmented">
            <button
              type="button"
              className={measurementMode === 'km' ? 'active' : ''}
              onClick={() => handleMeasurementModeChange('km')}
              disabled={isSubmitting}
            >
              {RU.items.measurementModeKm}
            </button>
            <button
              type="button"
              className={measurementMode === 'calendar' ? 'active' : ''}
              onClick={() => handleMeasurementModeChange('calendar')}
              disabled={isSubmitting}
            >
              {RU.items.measurementModeCalendar}
            </button>
          </div>
          <small className="form-help-text">
            {measurementMode === 'km' 
              ? RU.items.measurementModeHelpKm 
              : RU.items.measurementModeHelpCalendar}
          </small>
        </div>

        {/* Show intervalKm only for km mode */}
        {measurementMode === 'km' && (
          <div className="form-field">
            <label htmlFor="intervalKm">
              {RU.items.intervalKmLabel}
              <span style={{ color: '#dc2626' }}> *</span>
            </label>
            <input
              id="intervalKm"
              type="text"
              inputMode="numeric"
              pattern="[0-9\s]*"
              value={intervalKm}
              onChange={(e) => setIntervalKm(formatMileageInput(e.target.value))}
              disabled={isSubmitting}
              placeholder={RU.items.intervalKmPlaceholder}
              className="mileage-input"
              required
            />
          </div>
        )}

        {/* Show Y/M/D wheel picker only for calendar mode */}
        {measurementMode === 'calendar' && (
          <div className="form-field">
            <label>
              {RU.items.intervalCalendarLabel}
              <span style={{ color: '#dc2626' }}> *</span>
            </label>
            <WheelPicker
              years={intervalYears}
              months={intervalMonths}
              days={intervalDaysParts}
              onChange={({ years, months, days }) => {
                setIntervalYears(years);
                setIntervalMonths(months);
                setIntervalDaysParts(days);
              }}
            />
            <small className="form-help-text">{RU.items.intervalCalendarHelp}</small>
          </div>
        )}

        <div className="form-field">
          <label htmlFor="notifyBeforeDays">
            {RU.items.notifyBeforeDaysLabel}
            <span style={{ color: '#dc2626' }}> *</span>
          </label>
          <input
            id="notifyBeforeDays"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={notifyBeforeDays}
            onChange={(e) => setNotifyBeforeDays(e.target.value.replace(/\D/g, ''))}
            required
            disabled={isSubmitting}
            placeholder={RU.items.notifyBeforeDaysPlaceholder}
            className="mileage-input"
          />
          <small className="form-help-text">{RU.items.notifyBeforeDaysHelp}</small>
        </div>


        <div className="form-field">
          <label htmlFor="note">{RU.items.noteLabel}</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isSubmitting}
            placeholder={RU.items.notePlaceholder}
            rows={3}
            className="note-input"
          />
        </div>

        {/* Delete button (only in edit mode) */}
        {mode === 'edit' && (
          <div className="form-field">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isSubmitting}
              className="delete-item-button"
            >
              {RU.items.deleteButton}
            </button>
          </div>
        )}
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="cancel-button"
          >
            {RU.mileageForm.cancel}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !title.trim()}
            className="submit-button"
          >
            {isSubmitting 
              ? (mode === 'edit' ? RU.items.savingChanges : RU.mileageForm.saving)
              : (mode === 'edit' ? RU.items.saveChanges : RU.mileageForm.save)
            }
          </button>
        </div>
      </form>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="add-mileage-form-container">
          <div ref={deleteConfirmRef} className="add-mileage-form">
            <div className="form-header">
              {/* Grabber bar - iOS style */}
              <div className="sheet-grabber" />
              
              <div className="form-header-content">
                <h2>{RU.items.deleteConfirmTitle}</h2>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="close-button"
                  aria-label={RU.common.close}
                  disabled={isSubmitting}
                >
                  ×
                </button>
              </div>
            </div>

            <div className="form-content">
              <div className="form-field">
                <p className="delete-confirm-message">{RU.items.deleteConfirmText}</p>
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isSubmitting}
                className="cancel-button"
              >
                {RU.items.cancelDelete}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSubmitting}
                className="delete-button"
              >
                {isSubmitting ? RU.items.savingChanges : RU.items.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

