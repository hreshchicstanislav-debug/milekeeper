'use client';

import { useCopy } from '@/lib/i18n/client';

import ModalSheet from './ModalSheet';

import { useState, useRef, useEffect } from 'react';
import { addOdometerEntry } from '@/lib/actions/odometerActions';
import { parseMileageInput, trimWhitespace } from '@/lib/utils/numberFormat';
import { isTestMode } from '@/lib/appMode';
import { getAppNow, setAppNow } from '@/lib/appNow';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from '@/lib/time/datetimeLocal';
import { useSwipeToClose } from './useSwipeToClose';
import { previewEntryGain } from '@/lib/mileage/mileageGain';
import { resolveNewReadingTime } from '@/lib/mileage/readingChronology';
import { addMileageErrorText } from '@/lib/mileage/addMileageMessages';
import type { OdometerEntry } from '@/lib/db/types';

interface AddMileageFormProps {
  buttonLabel?: string;
  /** Highest actual reading (the baseline the server validates against), for the live gain hint. */
  lastMileageKm?: number | null;
  /** `occurred_at` of the latest reading by date: new readings may not be dated earlier. */
  latestReadingAt?: string | null;
  /**
   * Controlled mode, without the trigger button: another form opens this one (e.g. the
   * service record form's "Update odometer"). The reading is still saved separately.
   */
  open?: boolean;
  /** Prefilled reading when opened in controlled mode. */
  initialMileageKm?: number | null;
  onClose?: () => void;
  /** Called with the saved reading before the form closes. */
  onSaved?: (entry: OdometerEntry) => void;
  returnFocusSelector?: string;
}

/**
 * Odometer reading form. The sheet body is mounted only while open, so each opening
 * starts from state built in its first render (prefilled reading, current time). No
 * effect re-initializes it afterwards, which could overwrite what the user already typed.
 */
export default function AddMileageForm({
  buttonLabel, lastMileageKm = null, latestReadingAt = null,
  open, initialMileageKm = null, onClose, onSaved, returnFocusSelector = '[data-add-mileage-trigger]',
}: AddMileageFormProps = {}) {
  const { RU } = useCopy();
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlled ? open : internalOpen;
  const close = () => {
    if (!controlled) setInternalOpen(false);
    else onClose?.();
  };

  return (
    <>
      {!controlled && (
        <button
          type="button"
          onClick={() => setInternalOpen(true)}
          className="add-mileage-button"
          data-add-mileage-trigger
        >
          {buttonLabel ?? RU.home.addMileage}
        </button>
      )}
      {isOpen && (
        <AddMileageSheet
          lastMileageKm={lastMileageKm}
          latestReadingAt={latestReadingAt}
          initialMileageKm={controlled ? initialMileageKm : null}
          onClose={close}
          onSaved={onSaved}
          returnFocusSelector={returnFocusSelector}
        />
      )}
    </>
  );
}

interface AddMileageSheetProps {
  lastMileageKm: number | null;
  latestReadingAt: string | null;
  initialMileageKm: number | null;
  onClose: () => void;
  onSaved?: (entry: OdometerEntry) => void;
  returnFocusSelector: string;
}

function AddMileageSheet({
  lastMileageKm, latestReadingAt, initialMileageKm, onClose, onSaved, returnFocusSelector,
}: AddMileageSheetProps) {
  const { formatMileageInput, formatNumber, displayDateTime, RU, t, intlLocale, errorMessageText } = useCopy();
  const setIsOpen = (next: boolean) => { if (!next) onClose(); };
  const [mileageKm, setMileageKm] = useState(() => (initialMileageKm ? formatMileageInput(String(initialMileageKm)) : ''));
  // TEST mode records at AppNow, LIVE mode at the browser time.
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeLocalValue(isTestMode() ? getAppNow() : new Date()));
  const [showDate, setShowDate] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mileageInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Update occurredAt when AppNow changes in TEST mode (e.g., after simulation)
  useEffect(() => {
    if (isTestMode()) {
      const interval = setInterval(() => {
        const appNow = getAppNow();
        setOccurredAt(toDateTimeLocalValue(appNow));
      }, 1000); // Update every second to stay in sync with Test Clock

      return () => clearInterval(interval);
    }
  }, []);

  useEffect(() => {
    mileageInputRef.current?.focus();
  }, []);

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
    } else if (showDate) {
      submissionOccurredAt = fromDateTimeLocalValue(occurredAt);
    } else {
      // Date not changed by the user: record the moment of saving (the form may have
      // been open for a while, and the minute-rounded value could fall before a
      // reading saved in the meantime).
      submissionOccurredAt = new Date();
    }

    // Explain the chronology rule before sending; the server enforces it as well (with the
    // freshest latest reading, and stores a same-minute time just after that reading).
    const readingTime = resolveNewReadingTime(submissionOccurredAt, latestReadingAt);
    if (!readingTime.ok) {
      setError(addMileageErrorText({ RU, displayDateTime }, { reason: 'date-before-latest', latestOccurredAt: readingTime.latestOccurredAt }));
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await addOdometerEntry({
        occurredAt: submissionOccurredAt,
        mileageKm: mileage,
        note: note ? trimWhitespace(note) : null,
      });
      if (!result.ok) {
        setError(addMileageErrorText({ RU, displayDateTime }, result));
        return;
      }
      const insertedEntry = result.entry;

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
      onSaved?.(insertedEntry);
      setIsOpen(false);

      // No manual refresh here: addOdometerEntry() is a server action that calls
      // revalidatePath('/'), so Next.js re-renders the current page and streams the
      // updated RSC payload back in the same response as the action result.
    } catch (err) {
      // Unexpected failure (session, database, network): never show server details.
      console.error('Failed to add odometer entry', err);
      setError(addMileageErrorText({ RU, displayDateTime }, { reason: 'unexpected' }));
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
  useSwipeToClose<HTMLFormElement>(formRef, handleCancel, true);

  // Recomputed on every keystroke; nothing is shown for empty, partial or invalid input.
  const gainPreview = previewEntryGain(mileageKm, lastMileageKm);

  return (
    <ModalSheet label={RU.mileageForm.title} onClose={handleCancel} busy={isSubmitting} returnFocusSelector={returnFocusSelector}>
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
          {error && <div className="error-message">{errorMessageText(error)}</div>}

          <div className="form-field">
            <label htmlFor="mileageKm">{RU.mileageForm.mileageLabel}</label>
            <input
              ref={mileageInputRef}
              id="mileageKm"
              type="text"
              inputMode="numeric"
              pattern="[0-9,\s]*"
              value={formatMileageInput(mileageKm)}
              onChange={(e) => setMileageKm(formatMileageInput(e.target.value))}
              required
              disabled={isSubmitting}
              placeholder={RU.mileageForm.mileagePlaceholder}
              className="mileage-input"
              aria-describedby={lastMileageKm !== null ? 'mileageGainPreview' : undefined}
            />
            {lastMileageKm !== null && (
              <p id="mileageGainPreview" className="form-field-hint mileage-gain-preview" aria-live="polite" data-gain={gainPreview.kind}>
                {gainPreview.kind === 'gain'
                  ? RU.mileageForm.gainPreview.replace('{value}', formatNumber(gainPreview.km))
                  : gainPreview.kind === 'not-greater'
                    ? RU.mileageForm.notGreaterHint.replace('{value}', formatNumber(gainPreview.lastKm))
                    : null}
              </p>
            )}
          </div>

          <div className="form-field">
            {isTestMode() ? (
              // TEST mode: show AppNow value (read-only, no date picker)
              <div>
                <div style={{ fontSize: '0.875rem', color: 'rgba(0, 0, 0, 0.6)', marginBottom: 'var(--sp-2, 0.5rem)' }}>

                  {t("Дата (тестовое время):")} {fromDateTimeLocalValue(occurredAt).toLocaleString(intlLocale, {
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'rgba(0, 0, 0, 0.5)' }}>

                  {t("В режиме тестирования используется AppNow. Изменить дату нельзя.")}
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
    </ModalSheet>
  );
}
