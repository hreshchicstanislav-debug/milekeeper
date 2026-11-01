import { describe, expect, it } from 'vitest';
import { createCopy } from '@/lib/i18n/copy';
import { addMileageErrorText } from '../addMileageMessages';

const latest = '2026-11-01T05:30:37.000Z';
const ru = createCopy('ru');
const en = createCopy('en');

describe('addMileageErrorText', () => {
  it('explains the chronology rejection with the latest reading date (RU/EN)', () => {
    const rejection = { reason: 'date-before-latest', latestOccurredAt: latest } as const;
    expect(addMileageErrorText(ru, rejection)).toBe(`Дата показания не может быть раньше последней записи пробега: ${ru.displayDateTime(new Date(latest))}`);
    expect(addMileageErrorText(en, rejection)).toBe(`The reading date cannot be earlier than the latest odometer reading: ${en.displayDateTime(new Date(latest))}`);
    // The date shown is the minute the user may still pick.
    expect(addMileageErrorText(en, rejection)).not.toMatch(/:37\b/);
  });

  it('explains the mileage rejection (RU/EN)', () => {
    expect(addMileageErrorText(ru, { reason: 'mileage-not-greater' })).toBe('Пробег должен быть больше предыдущего значения');
    expect(addMileageErrorText(en, { reason: 'mileage-not-greater' })).toBe(en.RU.mileageForm.errorMileageMustBeGreater);
    expect(en.RU.mileageForm.errorMileageMustBeGreater).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('uses a safe generic text for invalid input and unexpected errors (RU/EN)', () => {
    for (const reason of ['invalid-input', 'unexpected'] as const) {
      expect(addMileageErrorText(ru, { reason })).toBe('Не удалось добавить запись пробега');
      expect(addMileageErrorText(en, { reason })).toBe(en.RU.mileageForm.errorFailedToAdd);
      expect(addMileageErrorText(en, { reason })).not.toMatch(/[А-Яа-яЁё]/);
    }
  });
});
