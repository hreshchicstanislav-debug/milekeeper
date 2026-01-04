'use client';

import { useState } from 'react';
import AddServiceEventForm from './AddServiceEventForm';
import { RU } from '@/lib/copy/ru';

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
  const [isFormOpen, setIsFormOpen] = useState(false);

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

  return (
    <>
      <button
        type="button"
        onClick={() => setIsFormOpen(true)}
        className="mark-replacement-button"
      >
        {RU.items.markReplacement}
      </button>
      <AddServiceEventForm
        serviceItemId={serviceItemId}
        serviceItemTitle={serviceItemTitle}
        defaultMileage={defaultMileage}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSuccess={onSuccess}
      />
    </>
  );
}

