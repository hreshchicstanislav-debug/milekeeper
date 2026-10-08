'use client';

import { useCopy } from '@/lib/i18n/client';

import { useState } from 'react';
import EditLatestMileage from '@/app/components/EditLatestMileage';
import type { OdometerEntry } from '@/lib/db/types';

interface EditLatestMileageButtonProps {
  latestEntry: OdometerEntry;
}

export default function EditLatestMileageButton({
  latestEntry,
}: EditLatestMileageButtonProps) {
  const { RU } = useCopy();
  const [isFormOpen, setIsFormOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsFormOpen(true)}
        className="edit-latest-button"
      >
        {RU.history.edit.button}
      </button>
      <EditLatestMileage
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        latestEntry={latestEntry}
      />
    </>
  );
}

