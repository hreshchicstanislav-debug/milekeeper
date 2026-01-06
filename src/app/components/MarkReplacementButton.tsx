'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
  const [currentMileage, setCurrentMileage] = useState<number | null>(defaultMileage ?? null);
  const router = useRouter();

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
    // Refresh data before opening form to ensure we have latest mileage
    // This is critical for Vercel where cached data might be stale
    // Add cache-busting parameter to force fresh data fetch
    const url = new URL(window.location.href);
    url.searchParams.set('_t', Date.now().toString());
    router.replace(url.pathname + url.search, { scroll: false });
    router.refresh();
    // Open form after a short delay to allow refresh to complete
    // The form will use the updated defaultMileage from props after refresh
    setTimeout(() => {
      setIsFormOpen(true);
    }, 100);
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

