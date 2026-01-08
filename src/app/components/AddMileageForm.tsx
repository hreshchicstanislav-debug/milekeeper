'use client';

import { useState, useRef, useEffect, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addOdometerEntry } from '@/lib/actions/odometerActions';
import { RU } from '@/lib/copy/ru';
import { formatMileageInput, parseMileageInput, trimWhitespace } from '@/lib/utils/numberFormat';
import { getAppMode, AppMode, isTestMode } from '@/lib/appMode';
import { getAppNow, setAppNow } from '@/lib/appNow';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from '@/lib/time/datetimeLocal';
import { useSwipeToClose } from './useSwipeToClose';

export default function AddMileageForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [mileageKm, setMileageKm] = useState('');
  const [appMode, setAppMode] = useState<AppMode>(AppMode.LIVE);
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocalValue(new Date()));
  const [showDate, setShowDate] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const mileageInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Update mode and occurredAt when form opens or mode changes
  useEffect(() => {
    const currentMode = getAppMode();
    setAppMode(currentMode);
    
    if (isTestMode()) {
      // TEST mode: use AppNow
      const appNow = getAppNow();
      setOccurredAt(toDateTimeLocalValue(appNow));
      setShowDate(false); // Hide date picker in TEST mode
    } else {
      // LIVE mode: use browser time
      setOccurredAt(toDateTimeLocalValue(new Date()));
    }
  }, [isOpen]);

  // Update occurredAt when AppNow changes in TEST mode (e.g., after simulation)
  useEffect(() => {
    if (isOpen && isTestMode()) {
      const interval = setInterval(() => {
        const appNow = getAppNow();
        setOccurredAt(toDateTimeLocalValue(appNow));
      }, 1000); // Update every second to stay in sync with Test Clock
      
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && mileageInputRef.current) {
      mileageInputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const mileage = parseMileageInput(mileageKm);
    if (mileage === null || mileage <= 0) {
      setError(RU.mileageForm.errorInvalidMileage);
      setIsSubmitting(false);
      return;
    }

    // In TEST mode, use current AppNow at submission time (not stale state)
    // In LIVE mode, parse the datetime-local value as local time
    let submissionOccurredAt: Date;
    if (isTestMode()) {
      submissionOccurredAt = getAppNow();
    } else {
      submissionOccurredAt = fromDateTimeLocalValue(occurredAt);
    }

    try {
      const insertedEntry = await addOdometerEntry({
        occurredAt: submissionOccurredAt,
        mileageKm: mileage,
        note: note ? trimWhitespace(note) : null,
      });

      // In TEST mode: advance AppNow to keep timeline monotonic and avoid duplicate timestamps
      // This ensures (a) new entry is never 'in the future' relative to AppNow,
      // (b) subsequent window-based calculations have recent data, and
      // (c) timestamps remain strictly increasing even with rapid actions
      if (isTestMode()) {
        const insertedDate = new Date(insertedEntry.occurred_at);
        const currentAppNow = getAppNow();
        // Use max(AppNow, inserted.occurred_at) + 1 minute to ensure strict monotonicity
        const newAppNow = new Date(Math.max(currentAppNow.getTime(), insertedDate.getTime()) + 60 * 1000); // +1 minute
        setAppNow(newAppNow);
        // Update local state to reflect new AppNow
        setOccurredAt(toDateTimeLocalValue(newAppNow));
      }

      // Success: reset form and close
      setMileageKm('');
      setNote('');
      // Reset occurredAt based on current mode (already updated for TEST mode above)
      if (!isTestMode()) {
        setOccurredAt(toDateTimeLocalValue(new Date()));
      }
      setShowDate(false);
      setShowNote(false);
      setIsOpen(false);
      
      // Force refresh with cache-busting to ensure data updates on Vercel
      // Use startTransition for smoother UI update, but also add cache-busting
      startTransition(() => {
        // Add cache-busting parameter to force fresh data fetch
        const url = new URL(window.location.href);
        url.searchParams.set('_t', Date.now().toString());
        // Use replace to avoid adding to history, but ensure fresh data
        router.replace(url.pathname + url.search);
        router.refresh();
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : RU.mileageForm.errorFailedToAdd;
      // Переводим известные ошибки с сервера
      if (errorMessage.includes('Mileage must be greater')) {
        setError(RU.mileageForm.errorMileageMustBeGreater);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    setMileageKm('');
    setNote('');
    setError(null);
    setShowDate(false);
    setShowNote(false);
  };

  // Swipe-to-close gesture
  useSwipeToClose<HTMLFormElement>(formRef, handleCancel, isOpen);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="add-mileage-button"
      >
        {RU.home.addMileage}
      </button>
    );
  }

  return (
    <div className="add-mileage-form-container">
      <form ref={formRef} onSubmit={handleSubmit} className="add-mileage-form">
        <div className="form-header">
          {/* Grabber bar - iOS style */}
          <div className="sheet-grabber" />
          
          <div className="form-header-content">
            <h2>{RU.mileageForm.title}</h2>
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

          <div className="form-field">
            <label htmlFor="mileageKm">{RU.mileageForm.mileageLabel}</label>
            <input
              ref={mileageInputRef}
              id="mileageKm"
              type="text"
              inputMode="numeric"
              pattern="[0-9\s]*"
              value={mileageKm}
              onChange={(e) => setMileageKm(formatMileageInput(e.target.value))}
              required
              disabled={isSubmitting}
              placeholder={RU.mileageForm.mileagePlaceholder}
              className="mileage-input"
            />
          </div>

          <div className="form-field">
            {isTestMode() ? (
              // TEST mode: show AppNow value (read-only, no date picker)
              <div>
                <div style={{ fontSize: '0.875rem', color: 'rgba(0, 0, 0, 0.6)', marginBottom: 'var(--sp-2, 0.5rem)' }}>
                  Дата (тестовое время): {fromDateTimeLocalValue(occurredAt).toLocaleString('ru-RU', { 
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'rgba(0, 0, 0, 0.5)' }}>
                  В режиме тестирования используется AppNow. Изменить дату нельзя.
                </div>
              </div>
            ) : (
              // LIVE mode: allow date picking (existing behavior)
              <>
                <button
                  type="button"
                  onClick={() => setShowDate(!showDate)}
                  className="toggle-button"
                  disabled={isSubmitting}
                >
                  {showDate ? '✓' : '○'} {RU.mileageForm.changeDate}
                </button>
                {showDate && (
                  <div style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
                    <input
                      type="datetime-local"
                      value={occurredAt}
                      onChange={(e) => setOccurredAt(e.target.value)}
                      disabled={isSubmitting}
                      className="date-input"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="form-field">
            <button
              type="button"
              onClick={() => setShowNote(!showNote)}
              className="toggle-button"
              disabled={isSubmitting}
            >
              {showNote ? '✓' : '○'} {RU.mileageForm.addNote}
            </button>
            {showNote && (
              <div style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={isSubmitting}
                  placeholder={RU.mileageForm.notePlaceholder}
                  rows={3}
                  className="note-input"
                />
              </div>
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
            {RU.mileageForm.cancel}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !mileageKm}
            className="submit-button"
          >
            {isSubmitting ? RU.mileageForm.saving : RU.mileageForm.save}
          </button>
        </div>
      </form>
    </div>
  );
}

