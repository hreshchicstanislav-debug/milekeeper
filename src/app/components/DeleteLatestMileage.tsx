'use client';

import { useCopy } from '@/lib/i18n/client';

import ModalSheet from './ModalSheet';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { deleteLatestOdometerEntry } from '@/lib/actions/odometerActions';
import { useSwipeToClose } from './useSwipeToClose';

interface DeleteLatestMileageProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DeleteLatestMileage({
  isOpen,
  onClose,
}: DeleteLatestMileageProps) {
  const { RU, errorMessageText } = useCopy();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const formRef = useRef<HTMLDivElement>(null);

  const handleDelete = async () => {
    setError(null);
    setIsDeleting(true);

    try {
      await deleteLatestOdometerEntry();
      // Success: close and refresh
      setIsDeleting(false);
      onClose();
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : RU.history.delete.error;
      // Map known errors to RU strings
      if (errorMessage.includes('Нет записей для удаления')) {
        setError(RU.history.delete.noEntries);
      } else {
        setError(errorMessage);
      }
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    onClose();
  };

  // Swipe-to-close gesture
  useSwipeToClose<HTMLDivElement>(formRef, handleCancel, isOpen);

  if (!isOpen) {
    return null;
  }

  return (
    <ModalSheet label={RU.history.delete.confirmTitle} onClose={handleCancel} busy={isDeleting}>
      <div ref={formRef} className="add-mileage-form">
        <div className="form-header">
          {/* Grabber bar - iOS style */}
          <div className="sheet-grabber" />
          
          <div className="form-header-content">
            <h2>{RU.history.delete.confirmTitle}</h2>
            <button
              type="button"
              onClick={handleCancel}
              className="close-button"
              aria-label={RU.common.close}
              disabled={isDeleting}
            >
              ×
            </button>
          </div>
        </div>

        <div className="form-content">
          {error && <div className="error-message">{errorMessageText(error)}</div>}

          <div className="form-field">
            <p className="delete-confirm-message">{RU.history.delete.confirmMessage}</p>
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isDeleting}
            className="cancel-button"
          >
            {RU.history.delete.cancel}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="delete-button"
          >
            {isDeleting ? RU.history.delete.deleting : RU.history.delete.delete}
          </button>
        </div>
      </div>
    </ModalSheet>
  );
}

