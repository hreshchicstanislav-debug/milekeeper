'use client';

import { useState } from 'react';
import EditLatestMileage from '@/app/components/EditLatestMileage';
import { RU } from '@/lib/copy/ru';
import type { OdometerEntry } from '@/lib/db/types';

interface EditLatestMileageButtonProps {
  latestEntry: OdometerEntry;
}

export default function EditLatestMileageButton({
  latestEntry,
}: EditLatestMileageButtonProps) {
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

