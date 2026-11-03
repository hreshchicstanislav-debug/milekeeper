'use client';

import { useCopy } from '@/lib/i18n/client';

import { useState } from 'react';
import AddServiceEventForm from './AddServiceEventForm';
import type { ServiceEventKind } from '@/lib/db/types';

interface AddServiceRecordButtonProps {
  serviceItemId: string;
  serviceItemTitle: string;
  /** Last actual (manually entered) odometer reading, prefilled into the form. */
  defaultMileage?: number | null;
  /** Date of the actual reading behind `defaultMileage`, shown next to it in the form. */
  lastReadingAt?: string | null;
  disabled?: boolean;
  disabledHint?: string;
  onSuccess?: (kind: ServiceEventKind) => void;
}

/** "Add record": opens the service record form (replacement, check or top-up). */
export default function AddServiceRecordButton({
  serviceItemId,
  serviceItemTitle,
  defaultMileage,
  lastReadingAt = null,
  disabled = false,
  disabledHint,
  onSuccess,
}: AddServiceRecordButtonProps) {
  const { RU } = useCopy();
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
          {RU.items.addRecord}
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
        // Opens immediately: `defaultMileage` is the actual odometer reading the server
        // component already resolved for this render.
        onClick={() => setIsFormOpen(true)}
        className="mark-replacement-button"
        data-add-service-record
      >
        {RU.items.addRecord}
      </button>
      <AddServiceEventForm
        serviceItemId={serviceItemId}
        serviceItemTitle={serviceItemTitle}
        defaultMileage={defaultMileage ?? null}
        lastReadingAt={lastReadingAt}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSuccess={onSuccess}
      />
    </>
  );
}
