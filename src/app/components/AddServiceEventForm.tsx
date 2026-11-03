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
  parseAmountLitersInput,
  SERVICE_EVENT_KINDS,
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
 * One form for every kind of service record. The user first chooses what they did
 * (nothing is preselected), then fills the fields of that kind.
 */
export default function AddServiceEventForm({
  serviceItemId,
  serviceItemTitle,
  defaultMileage,
  lastReadingAt = null,
  isOpen,
  onClose,
  onSuccess,
}: AddServiceEventFormProps) {
  const { formatMileageInput, formatNumber, RU } = useCopy();
  const copy = RU.items.serviceEvent;
  const [kind, setKind] = useState<ServiceEventKind | null>(null);
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [mileageKm, setMileageKm] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Latest recorded reading known to this form: from props, or from an odometer update
  // made from here (before the refreshed server data arrives).
  const [lastReading, setLastReading] = useState<Reading | null>(null);
  const [isOdometerOpen, setIsOdometerOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  // On a phone the form scrolls: bring a new message into view next to the fields.
  useEffect(() => {
    if (error || notice) messageRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [error, notice]);

  useSwipeToClose<HTMLFormElement>(formRef, onClose, isOpen && !isOdometerOpen);

  // Reset only when the form opens. A later props change (the odometer updated from this
  // form refreshes the page) must keep what the user has entered.
  useEffect(() => {
    if (!isOpen) return;
    setKind(null);
    setDate(toDateInputValue(new Date()));
    setMileageKm(defaultMileage ? formatMileageInput(String(defaultMileage)) : '');
    setAmount('');
    setNote('');
    setError(null);
    setNotice(null);
    setIsOdometerOpen(false);
    setLastReading(defaultMileage ? { km: defaultMileage, at: lastReadingAt } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // A newer reading from the server only moves the baseline forward.
  useEffect(() => {
    if (!isOpen || !defaultMileage) return;
    setLastReading((current) => (current && current.km >= defaultMileage ? current : { km: defaultMileage, at: lastReadingAt }));
  }, [isOpen, defaultMileage, lastReadingAt]);

  const rejectionError = (rejection: AddServiceEventRejection, enteredKm: number): FormError => {
    switch (rejection.reason) {
      case 'mileage-above-odometer':
        return { type: 'above-odometer', enteredKm, odometerKm: rejection.odometerKm };
      case 'invalid-amount':
        return { type: 'text', text: copy.errorAmountInvalid };
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
      setError({ type: 'text', text: copy.errorDateInFuture });
      return;
    }
    const mileage = parseMileageInput(mileageKm);
    if (mileage === null || mileage <= 0) {
      setError({ type: 'text', text: mileageKm.trim() ? copy.errorMileageInvalid : copy.errorMileageRequired });
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

  if (!isOpen) {
    return null;
  }

  const enteredMileage = parseMileageInput(mileageKm);
  const [readingBefore, readingAfter] = copy.lastReading.replace('{value}', lastReading ? formatNumber(lastReading.km) : '').split('{date}');

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

          <fieldset className={`service-event-kinds${kind ? ' is-chosen' : ''}`} disabled={isSubmitting}>
            <legend className="service-event-kinds-legend">{kind ? copy.kindLabel : copy.kindQuestion}</legend>
            <div className="service-event-kind-options">
              {SERVICE_EVENT_KINDS.map((option) => (
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

          {kind && (
            <>
              <div className="form-field">
                <label htmlFor="serviceEventDate">{copy.dateLabel}</label>
                <input
                  id="serviceEventDate"
                  type="date"
                  value={date}
                  max={toDateInputValue(new Date())}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  disabled={isSubmitting}
                  className="date-input"
                />
              </div>

              <div className="form-field">
                <label htmlFor="serviceEventMileageKm">{copy.mileageLabel}</label>
                <input
                  id="serviceEventMileageKm"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9,\s]*"
                  value={formatMileageInput(mileageKm)}
                  onChange={(e) => { setMileageKm(formatMileageInput(e.target.value)); if (error?.type === 'above-odometer') setError(null); }}
                  required
                  disabled={isSubmitting}
                  placeholder={copy.mileagePlaceholder}
                  className="mileage-input"
                  aria-describedby={lastReading ? 'serviceEventLastReading' : undefined}
                />
                {lastReading ? (
                  <p id="serviceEventLastReading" className="form-field-hint" data-testid="service-event-last-reading">
                    {readingBefore}
                    <LocalDateTime iso={lastReading.at} dateOnly fallback="—" />
                    {readingAfter}
                  </p>
                ) : null}
              </div>

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
            disabled={isSubmitting || !kind || !mileageKm}
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
