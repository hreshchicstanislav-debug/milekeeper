/**
 * Единый формат даты/времени для UI: ДД.ММ.ГГГГ HH:MM
 * Используется везде, где показывается occurred_at и другие даты
 */

export function formatDateTimeRu(input: string | Date | null | undefined): string {
  // Если input falsy, вернуть '—'
  if (!input) {
    return '—';
  }

  // Парсить дату
  const date = typeof input === 'string' ? new Date(input) : input;

  // Проверить, что дата валидна
  if (isNaN(date.getTime())) {
    return '—';
  }

  // Формат: DD.MM.YYYY HH:MM (24h, всегда с leading zeros)
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

