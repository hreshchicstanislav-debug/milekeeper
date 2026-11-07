'use client';

import { useCopy } from '@/lib/i18n/client';

import ModalSheet from './ModalSheet';
import AddMileageForm from './AddMileageForm';

import { useState, useRef, useEffect } from 'react';
import { addServiceEvent, type AddServiceEventRejection } from '@/lib/actions/serviceActions';
import type { ServiceEventKind } from '@/lib/db/types';
import { parseMileageInput } from '@/lib/utils/numberFormat';
import { occurredAtFromDateInput, toDateInputValue } from '@/lib/time/datetimeLocal';
import {
  CREATABLE_SERVICE_EVENT_KINDS,
  parseAmountLitersInput,
  SERVICE_EVENT_MIN_DATE,
  SERVICE_EVENT_NOTE_MAX_LENGTH,
} from '@/lib/service/serviceEventKinds';
import { LocalDateTime } from './LocalDateTime';
import { useSwipeToClose } from './useSwipeToClose';

interface AddServiceEventFormProps {
  serviceItemId: string;
  serviceItemTitle: string;
  /** Last actual odometer reading; prefilled into the field and shown as a hint. */
  defaultMileage?: number | null;
  /** Date of that reading, shown next to it so an old value is not taken for current. */
  lastReadingAt?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (kind: ServiceEventKind) => void;
}

type FormError =
  | { type: 'text'; text: string }
  /** The record is not saved; offer the separate odometer update. */
  | { type: 'above-odometer'; enteredKm: number; odometerKm: number };

interface Reading { km: number; at: string | null }

/**
 * One form for every creatable kind of service record (`CREATABLE_SERVICE_EVENT_KINDS`).
 * With several kinds the user first chooses what they did (nothing is preselected), then
 * fills the fields of that kind. With a single kind (release A: replacement only) it is
 * chosen from the start and the choice is not shown.
 *
 * The form body is mounted only while the form is open, so every opening starts from
 * fresh state built by the `useState` initializers in the very first render. There is
 * no reset effect: an effect runs after the form is already on screen and would undo a
 * choice the user made before it ran (e.g. a kind picked right after a quick reopen).
 */
export default function AddServiceEventForm(props: AddServiceEventFormProps) {
  return props.isOpen ? <AddServiceEventFormBody {...props} /> : null;
}

function AddServiceEventFormBody({
  serviceItemId,
  serviceItemTitle,
  defaultMileage,
  lastReadingAt = null,
  onClose,
  onSuccess,
}: AddServiceEventFormProps) {
  const { formatMileageInput, formatNumber, RU } = useCopy();
  const copy = RU.items.serviceEvent;
  const hasKindChoice = CREATABLE_SERVICE_EVENT_KINDS.length > 1;
  const [kind, setKind] = useState<ServiceEventKind | null>(() => (hasKindChoice ? null : CREATABLE_SERVICE_EVENT_KINDS[0] ?? null));
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  // What the user typed. Until they type, the field shows the last reading (see `mileageValue`).
  const [mileageKm, setMileageKm] = useState('');
  const [mileageTouched, setMileageTouched] = useState(false);
  // Today is shown as one compact line; the date input appears on demand.
  const [dateEditing, setDateEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Latest recorded reading known to this form: from props, or from an odometer update
  // made from here (before the refreshed server data arrives).
  const [lastReading, setLastReading] = useState<Reading | null>(
    () => (defaultMileage ? { km: defaultMileage, at: lastReadingAt } : null)
  );
  const [isOdometerOpen, setIsOdometerOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // On a phone the form scrolls: bring a new message into view next to the fields.
  useEffect(() => {
    if (error || notice) messageRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [error, notice]);

  useEffect(() => {
    if (dateEditing) dateInputRef.current?.focus();
  }, [dateEditing]);

  useSwipeToClose<HTMLFormElement>(formRef, onClose, !isOdometerOpen);

  // A later props change (the odometer updated from this form refreshes the page) keeps
  // what the user has entered: a newer reading from the server only moves the baseline
  // forward, and never touches the user's input.
  useEffect(() => {
    if (!defaultMileage) return;
    setLastReading((current) => (current && current.km >= defaultMileage ? current : { km: defaultMileage, at: lastReadingAt }));
  }, [defaultMileage, lastReadingAt]);

  // A date before the last odometer reading must not silently get that (later) reading's
  // mileage: the field stays empty until the user states the mileage for the chosen date.
  // What the user has typed is never replaced.
  const readingTime = lastReading?.at ? new Date(lastReading.at) : null;
  const readingDate = readingTime && !Number.isNaN(readingTime.getTime()) ? toDateInputValue(readingTime) : null;
  const isHistoricalDate = readingDate !== null && date !== '' && date < readingDate;
  const autoMileage = lastReading ? formatMileageInput(String(lastReading.km)) : '';
  const mileageValue = mileageTouched ? mileageKm : isHistoricalDate ? '' : autoMileage;

  const rejectionError = (rejection: AddServiceEventRejection, enteredKm: number): FormError => {
    switch (rejection.reason) {
      case 'mileage-above-odometer':
        return { type: 'above-odometer', enteredKm, odometerKm: rejection.odometerKm };
      case 'invalid-amount':
        return { type: 'text', text: copy.errorAmountInvalid };
      case 'date-in-future':
        return { type: 'text', text: copy.errorDateInFuture };
      case 'date-too-old':
        return { type: 'text', text: copy.errorDateTooOld };
      case 'item-unavailable':
        return { type: 'text', text: copy.errorItemUnavailable };
      case 'no-odometer':
        return { type: 'text', text: copy.errorNoOdometer };
      default:
        return { type: 'text', text: copy.errorFailedToAdd };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind || isSubmitting) return;
    setError(null);
    setNotice(null);

    const today = new Date();
    const occurredAt = date ? occurredAtFromDateInput(date, today) : null;
    if (!occurredAt) {
      setError({ type: 'text', text: copy.errorDateRequired });
      return;
    }
    if (date > toDateInputValue(today)) {
      setDateEditing(true);
      setError({ type: 'text', text: copy.errorDateInFuture });
      return;
    }
    if (date < SERVICE_EVENT_MIN_DATE) {
      setDateEditing(true);
      setError({ type: 'text', text: copy.errorDateTooOld });
      return;
    }
    const mileage = parseMileageInput(mileageValue);
    if (mileage === null || mileage <= 0) {
      setError({ type: 'text', text: mileageValue.trim() ? copy.errorMileageInvalid : copy.errorMileageRequired });
      return;
    }
    const amountInput = kind === 'top_up' ? parseAmountLitersInput(amount) : { ok: true as const, value: null };
    if (!amountInput.ok) {
      setError({ type: 'text', text: copy.errorAmountInvalid });
      return;
    }
    const trimmedNote = note.trim();
    if (trimmedNote.length > SERVICE_EVENT_NOTE_MAX_LENGTH) {
      setError({ type: 'text', text: copy.errorNoteTooLong });
      return;
    }
    // Explain the rule before sending; the server enforces it with the freshest reading.
    if (lastReading && mileage > lastReading.km) {
      setError({ type: 'above-odometer', enteredKm: mileage, odometerKm: lastReading.km });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await addServiceEvent({
        serviceItemId,
        kind,
        occurredAt,
        mileageKm: mileage,
        amountLiters: amountInput.value,
        note: trimmedNote || null,
      });
      if (!result.ok) {
        if (result.reason === 'mileage-above-odometer') {
          setLastReading({ km: result.odometerKm, at: result.odometerAt });
        }
        if (result.reason === 'date-in-future' || result.reason === 'date-too-old') setDateEditing(true);
        setError(rejectionError(result, mileage));
        return;
      }
      // addServiceEvent() revalidates '/' and '/items', so the current route re-renders
      // with the action result. onSuccess() handles client-owned state only (toast,
      // the history list loaded from /api/service-events).
      onSuccess?.(kind);
      onClose();
    } catch (err) {
      // Unexpected failure (session, database, network): never show server details.
      console.error('Failed to add service event', err);
      setError({ type: 'text', text: copy.errorFailedToAdd });
    } finally {
      setIsSubmitting(false);
    }
  };

  const enteredMileage = parseMileageInput(mileageValue);
  const [readingBefore, readingAfter] = (isHistoricalDate ? copy.lastReadingHistorical : copy.lastReading)
    .replace('{value}', lastReading ? formatNumber(lastReading.km) : '').split('{date}');
  const todayValue = toDateInputValue(new Date());

  return (
    <>
    <ModalSheet label={`${copy.formTitle}: ${serviceItemTitle}`} onClose={onClose} busy={isSubmitting}>
      <form ref={formRef} onSubmit={handleSubmit} className="add-mileage-form service-event-form" noValidate>
        <div className="form-header">
          {/* Grabber bar - iOS style */}
          <div className="sheet-grabber" />

          <div className="form-header-content">
            <h2>{copy.formTitle}: {serviceItemTitle}</h2>
            <button
              type="button"
              onClick={onClose}
              className="close-button"
              aria-label={RU.common.close}
              disabled={isSubmitting}
            >
              ×
            </button>
          </div>
        </div>

        <div className="form-content">
          <div ref={messageRef}>
          {error?.type === 'text' && <div className="error-message" role="alert">{error.text}</div>}
          {error?.type === 'above-odometer' && (
            <div className="error-message service-event-odometer-error" role="alert" data-testid="service-event-above-odometer">
              <p>
                {copy.mileageAboveOdometer
                  .replace('{entered}', formatNumber(error.enteredKm))
                  .replace('{current}', formatNumber(error.odometerKm))}
              </p>
              <button
                type="button"
                className="btn btn-secondary service-event-update-odometer"
                onClick={() => setIsOdometerOpen(true)}
                disabled={isSubmitting}
              >
                {copy.updateOdometer}
              </button>
            </div>
          )}
          {notice && <div className="success-message" role="status">{notice}</div>}
          </div>

          {hasKindChoice && (
            <fieldset className={`service-event-kinds${kind ? ' is-chosen' : ''}`} disabled={isSubmitting}>
              <legend className="service-event-kinds-legend">{kind ? copy.kindLabel : copy.kindQuestion}</legend>
              <div className="service-event-kind-options">
                {CREATABLE_SERVICE_EVENT_KINDS.map((option) => (
                  <label key={option} className={`service-event-kind${kind === option ? ' is-selected' : ''}`} data-kind={option}>
                    <input
                      type="radio"
                      name="serviceEventKind"
                      value={option}
                      checked={kind === option}
                      onChange={() => { setKind(option); setError(null); }}
                    />
                    <span className="service-event-kind-title">{copy.kinds[option]}</span>
                    <span className="service-event-kind-hint">{copy.kindHints[option]}</span>
                  </label>
                ))}
              </div>
              {kind && <p className="form-field-hint service-event-kind-effect" data-testid="service-event-kind-effect">{copy.kindEffect[kind]}</p>}
            </fieldset>
          )}

          {kind && (
            <>
              {dateEditing || date !== todayValue ? (
                <div className="form-field">
                  <label htmlFor="serviceEventDate">{copy.dateLabel}</label>
                  <input
                    id="serviceEventDate"
                    ref={dateInputRef}
                    type="date"
                    value={date}
                    min={SERVICE_EVENT_MIN_DATE}
                    max={todayValue}
                    onChange={(e) => { setDate(e.target.value); setError(null); }}
                    required
                    disabled={isSubmitting}
                    className="date-input"
                  />
                </div>
              ) : (
                <div className="service-event-date-row" data-testid="service-event-date-today">
                  <span className="service-event-date-value">{copy.dateLabel}: {copy.dateToday}</span>
                  <button
                    type="button"
                    className="service-event-date-change"
                    onClick={() => setDateEditing(true)}
                    disabled={isSubmitting}
                  >
                    {copy.changeDate}
                  </button>
                </div>
              )}

              {kind === 'top_up' && (
                <div className="form-field">
                  <label htmlFor="serviceEventAmount">{copy.amountLabel}</label>
                  <input
                    id="serviceEventAmount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isSubmitting}
                    placeholder={copy.amountPlaceholder}
                    className="mileage-input"
                  />
                </div>
              )}

              <div className="form-field">
                <label htmlFor="serviceEventMileageKm">{copy.mileageLabel}</label>
                <input
                  id="serviceEventMileageKm"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9,\s]*"
                  value={mileageValue}
                  onChange={(e) => {
                    setMileageKm(formatMileageInput(e.target.value));
                    setMileageTouched(true);
                    if (error?.type === 'above-odometer') setError(null);
                  }}
                  required
                  disabled={isSubmitting}
                  placeholder={copy.mileagePlaceholder}
                  className="mileage-input"
                  aria-describedby={lastReading ? 'serviceEventLastReading' : undefined}
                />
                {lastReading ? (
                  <p
                    id="serviceEventLastReading"
                    className={`form-field-hint${isHistoricalDate ? ' is-attention' : ''}`}
                    data-testid={isHistoricalDate ? 'service-event-historical-reading' : 'service-event-last-reading'}
                  >
                    {readingBefore}
                    <LocalDateTime iso={lastReading.at} dateOnly fallback="—" />
                    {readingAfter}
                  </p>
                ) : null}
              </div>

              <div className="form-field">
                <label htmlFor="serviceEventNote">{copy.noteLabel}</label>
                <textarea
                  id="serviceEventNote"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={isSubmitting}
                  placeholder={copy.notePlaceholder}
                  maxLength={SERVICE_EVENT_NOTE_MAX_LENGTH}
                  rows={3}
                  className="note-input"
                />
              </div>
            </>
          )}
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="cancel-button"
          >
            {copy.cancel}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !kind || !mileageValue}
            className="submit-button"
            data-service-event-submit
          >
            {isSubmitting ? copy.saving : kind ? copy.save[kind] : RU.mileageForm.save}
          </button>
        </div>
      </form>
    </ModalSheet>
    {/* The odometer update stays a separate operation; this form keeps its input meanwhile. */}
    <AddMileageForm
      open={isOdometerOpen}
      initialMileageKm={enteredMileage}
      lastMileageKm={lastReading?.km ?? null}
      latestReadingAt={lastReading?.at ?? null}
      returnFocusSelector="[data-service-event-submit]"
      onClose={() => setIsOdometerOpen(false)}
      onSaved={(entry) => {
        setLastReading({ km: entry.mileage_km, at: entry.occurred_at });
        setError(null);
        setNotice(copy.odometerUpdated.replace('{value}', formatNumber(entry.mileage_km)));
      }}
    />
    </>
  );
}
