'use client';

import { useState } from 'react';
import DeleteLatestMileage from '@/app/components/DeleteLatestMileage';
import { RU } from '@/lib/copy/ru';

export default function DeleteLatestMileageButton() {
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

