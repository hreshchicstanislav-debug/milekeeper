/**
 * Утилиты для форматирования чисел при вводе километров
 */

/**
 * Форматирует число с разделением тысяч пробелами
 * Например: 7000 -> "7 000", 123456 -> "123 456"
 * @param value Строка с цифрами или число
 * @returns Отформатированная строка с пробелами тысяч
 */
export function formatMileageInput(value: string | number): string {
  // Удаляем все нецифровые символы
  const digitsOnly = String(value).replace(/\D/g, '');
  
  if (!digitsOnly) {
    return '';
  }
  
  // Добавляем пробелы для разделения тысяч (справа налево)
  return digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Очищает отформатированное число от пробелов и возвращает числовое значение
 * @param formattedValue Отформатированная строка (например, "7 000")
 * @returns Число или null, если значение пустое
 */
export function parseMileageInput(formattedValue: string): number | null {
  // Удаляем все пробелы и нецифровые символы
  const cleaned = formattedValue.replace(/\s/g, '').replace(/\D/g, '');
  
  if (!cleaned) {
    return null;
  }
  
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Очищает строку от пробелов в начале и конце
 * @param value Строка для очистки
 * @returns Очищенная строка
 */
export function trimWhitespace(value: string): string {
  return value.trim();
}

