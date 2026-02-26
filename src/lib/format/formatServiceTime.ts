function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}

export function pluralizeDays(days: number): string {
  return pluralizeRu(days, 'день', 'дня', 'дней');
}

export function pluralizeMonths(months: number): string {
  return pluralizeRu(months, 'месяц', 'месяца', 'месяцев');
}

function normalizeRemainingDays(value: number): number {
  return Math.max(0, Math.ceil(value));
}

function normalizeOverdueDays(value: number): number {
  return Math.max(1, Math.ceil(Math.abs(value)));
}

export function formatRemainingDays(remainingDays: number): string {
  const days = normalizeRemainingDays(remainingDays);
  if (days < 30) {
    return `Осталось ${days} ${pluralizeDays(days)}`;
  }

  const months = Math.floor(days / 30);
  const restDays = days % 30;
  if (restDays === 0) {
    return `Осталось ${months} ${pluralizeMonths(months)}`;
  }

  return `Осталось ${months} ${pluralizeMonths(months)} и ${restDays} ${pluralizeDays(restDays)}`;
}

export function formatOverdueDays(overdueDays: number): string {
  const days = normalizeOverdueDays(overdueDays);
  return `Просрочено на ${days} ${pluralizeDays(days)}`;
}

export function formatServiceTimeFromSignedDays(signedDays: number): string {
  if (signedDays < 0) {
    return formatOverdueDays(signedDays);
  }
  return formatRemainingDays(signedDays);
}
