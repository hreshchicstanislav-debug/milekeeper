'use client';

import { useState, useRef, useEffect, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addOdometerEntry } from '@/lib/actions/odometerActions';
import { RU } from '@/lib/copy/ru';
import { formatMileageInput, parseMileageInput, trimWhitespace } from '@/lib/utils/numberFormat';
import { useSwipeToClose } from './useSwipeToClose';

export default function AddMileageForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [mileageKm, setMileageKm] = useState('');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
  const [showDate, setShowDate] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const mileageInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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

    try {
      await addOdometerEntry({
        occurredAt: new Date(occurredAt),
        mileageKm: mileage,
        note: note ? trimWhitespace(note) : null,
      });

      // Success: reset form and close
      setMileageKm('');
      setNote('');
      setOccurredAt(new Date().toISOString().slice(0, 16));
      setShowDate(false);
      setShowNote(false);
      setIsOpen(false);
      
      // Use startTransition for smoother UI update
      startTransition(() => {
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

