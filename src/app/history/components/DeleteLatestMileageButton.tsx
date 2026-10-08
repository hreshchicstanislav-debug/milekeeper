'use client';

import { useCopy } from '@/lib/i18n/client';

import { useState } from 'react';
import DeleteLatestMileage from '@/app/components/DeleteLatestMileage';

export default function DeleteLatestMileageButton() {
  const { RU } = useCopy();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        className="delete-latest-button"
      >
        {RU.history.delete.button}
      </button>
      <DeleteLatestMileage
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
      />
    </>
  );
}

