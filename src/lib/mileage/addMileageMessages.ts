import type { createCopy } from '@/lib/i18n/copy';

type Copy = Pick<ReturnType<typeof createCopy>, 'RU' | 'displayDateTime'>;

/** A rejection returned by `addOdometerEntry`, or `unexpected` for a thrown error. */
export type AddMileageError =
  | { reason: 'mileage-not-greater' | 'invalid-input' | 'unexpected' }
  | { reason: 'date-before-latest'; latestOccurredAt: string };

/**
 * Localized text for a rejected new odometer reading. `unexpected` covers thrown errors
 * (auth, database, network): their details are never shown to the user.
 */
export function addMileageErrorText(copy: Copy, rejection: AddMileageError): string {
  switch (rejection.reason) {
    case 'mileage-not-greater':
      return copy.RU.mileageForm.errorMileageMustBeGreater;
    case 'date-before-latest':
      return copy.RU.mileageForm.errorDateBeforeLatest.replace('{date}', copy.displayDateTime(new Date(rejection.latestOccurredAt)));
    case 'invalid-input':
    case 'unexpected':
      return copy.RU.mileageForm.errorFailedToAdd;
  }
}
