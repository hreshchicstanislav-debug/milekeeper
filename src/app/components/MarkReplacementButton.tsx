'use client';

import { useCopy } from '@/lib/i18n/client';

import { useState, useEffect } from 'react';
import AddServiceEventForm from './AddServiceEventForm';

interface MarkReplacementButtonProps {
  serviceItemId: string;
  serviceItemTitle: string;
  defaultMileage?: number | null;
  disabled?: boolean;
  disabledHint?: string;
  onSuccess?: () => void;
}

export default function MarkReplacementButton({
  serviceItemId,
  serviceItemTitle,
  defaultMileage,
  disabled = false,
  disabledHint,
  onSuccess,
}: MarkReplacementButtonProps) {
  const { RU } = useCopy();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [currentMileage, setCurrentMileage] = useState<number | null>(defaultMileage ?? null);

  // Update currentMileage when defaultMileage prop changes (after server refresh)
  useEffect(() => {
    if (defaultMileage !== null && defaultMileage !== undefined) {
      setCurrentMileage(defaultMileage);
    }
  }, [defaultMileage]);

  if (disabled) {
    return (
      <>
        <button
          type="button"
          disabled
          className="mark-replacement-button disabled"
          title={disabledHint}
        >
          {RU.items.markReplacement}
        </button>
        {disabledHint && (
          <p className="mark-replacement-hint">{disabledHint}</p>
        )}
      </>
    );
  }

  const handleOpenForm = () => {
    // Open immediately: `defaultMileage` is the actual (manually entered) odometer
    // reading that the server component already resolved for this render, so there is
    // nothing to wait for. The previous refresh-then-open dance cost two full server
    // renders plus a 100ms timer before any UI appeared.
    setIsFormOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpenForm}
        className="mark-replacement-button"
      >
        {RU.items.markReplacement}
      </button>
      <AddServiceEventForm
        serviceItemId={serviceItemId}
        serviceItemTitle={serviceItemTitle}
        defaultMileage={currentMileage ?? defaultMileage ?? null}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSuccess={onSuccess}
      />
    </>
  );
}

