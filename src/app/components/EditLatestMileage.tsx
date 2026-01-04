'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { updateLatestOdometerEntry } from '@/lib/actions/odometerActions';
import { RU } from '@/lib/copy/ru';
import { formatMileageInput, parseMileageInput, trimWhitespace } from '@/lib/utils/numberFormat';
import type { OdometerEntry } from '@/lib/db/types';
import { useSwipeToClose } from './useSwipeToClose';

interface EditLatestMileageProps {
  isOpen: boolean;
  onClose: () => void;
  latestEntry: OdometerEntry;
}

export default function EditLatestMileage({
  isOpen,
  onClose,
  latestEntry,
}: EditLatestMileageProps) {
  const [mileageKm, setMileageKm] = useState(
    formatMileageInput(String(latestEntry.mileage_km))
  );
  const [occurredAt, setOccurredAt] = useState(
    new Date(latestEntry.occurred_at).toISOString().slice(0, 16)
  );
  const [showDate, setShowDate] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(latestEntry.note || '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const mileageInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Сбрасываем форму при открытии с данными последней записи
      setMileageKm(formatMileageInput(String(latestEntry.mileage_km)));
      setOccurredAt(new Date(latestEntry.occurred_at).toISOString().slice(0, 16));
      setNote(latestEntry.note || '');
      setShowDate(false);
      setShowNote(false);
      setError(null);
      // Фокус на поле пробега
      setTimeout(() => mileageInputRef.current?.focus(), 100);
    }
  }, [isOpen, latestEntry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const mileage = parseMileageInput(mileageKm);
    if (mileage === null || mileage <= 0) {
      setError(RU.history.edit.errorInvalidMileage);
      setIsSubmitting(false);
      return;
    }

    try {
      await updateLatestOdometerEntry({
        mileageKm: mileage,
        occurredAt: new Date(occurredAt),
        note: note ? trimWhitespace(note) : null,
      });

      // Success: close and refresh
      setIsSubmitting(false);
      onClose();
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : RU.history.edit.errorFailedToSave;
      // Map known errors to RU strings
      if (errorMessage.includes('Пробег должен быть больше предыдущей записи') || 
          errorMessage.includes('must be greater than previous')) {
        setError(RU.history.edit.errorMileageMustBeGreater);
      } else if (errorMessage.includes('Нет записей для редактирования')) {
        setError(RU.history.edit.errorNoEntries);
      } else {
        setError(errorMessage);
      }
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    onClose();
  };

  // Swipe-to-close gesture
  useSwipeToClose<HTMLFormElement>(formRef, handleCancel, isOpen);

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
            <h2>{RU.history.edit.title}</h2>
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
          <label htmlFor="editMileageKm">{RU.history.edit.mileageLabel}</label>
          <input
            ref={mileageInputRef}
            id="editMileageKm"
            type="text"
            inputMode="numeric"
            pattern="[0-9\s]*"
            value={mileageKm}
            onChange={(e) => setMileageKm(formatMileageInput(e.target.value))}
            required
            disabled={isSubmitting}
            placeholder={RU.history.edit.mileagePlaceholder}
            className="mileage-input"
          />
        </div>

        <div className="form-field">
          <button
            type="button"
            onClick={() => setShowDate(!showDate)}
            className="toggle-button"
          >
            {showDate ? '✓' : '○'} {RU.history.edit.changeDate}
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
            {showNote ? '✓' : '○'} {RU.history.edit.noteLabel}
          </button>
          {showNote && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isSubmitting}
              placeholder={RU.history.edit.notePlaceholder}
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
            {RU.history.edit.cancel}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !mileageKm}
            className="submit-button"
          >
            {isSubmitting ? RU.history.edit.saving : RU.history.edit.save}
          </button>
        </div>
      </form>
    </div>
  );
}

