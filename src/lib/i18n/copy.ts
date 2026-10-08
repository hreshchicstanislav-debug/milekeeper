import { formatMileageInput as formatMileageInputRu } from '@/lib/utils/numberFormat';
import { RU, formatDateTime as formatDateTimeRu } from '@/lib/copy/ru';
import { formatDateTimeRu as displayDateTimeRu } from '@/lib/ui/formatDateTimeRu';
import { EN } from './en';
import { localizedPath, type Locale } from './routing';
import { formatServiceTimeFromSignedDays as serviceTimeRu } from '@/lib/format/formatServiceTime';

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];
// Adding Russian copy without an English counterpart is a compile-time error.
const completeEnglish: Record<Leaves<typeof RU>, string> = EN;
export type TranslationKey = keyof typeof EN;
export const intlLocale = (locale: Locale) => locale === 'en' ? 'en-US' : 'ru-RU';
export function translate(locale: Locale, key: TranslationKey): string { return locale === 'en' ? EN[key] : key; }
function mapCopy<T>(value: T): Widen<T> {
  if (typeof value === 'string') return completeEnglish[value as Leaves<typeof RU>] as Widen<T>;
  return Object.fromEntries(Object.entries(value as object).map(([key, entry]) => [key, mapCopy(entry)])) as Widen<T>;
}
export const englishCopy = mapCopy(RU);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(EN).filter(([key]) => key.includes('{')).sort(([a], [b]) => b.length - a.length).map(([key, value]) => {
  const names: string[] = [];
  const parts = key.split(/(\{\w+\})/g).map(part => {
    if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '(.+?)'; }
    return escapeRegex(part);
  });
  return { regex: new RegExp(`^${parts.join('')}$`), names, value };
});
/** Only for known system output (status/explanation/auth error), never titles or notes. */
export function translateSystem(locale: Locale, text: string): string {
  if (locale === 'ru') return Object.entries(EN).find(([, value]) => value === text)?.[0] ?? text;
  if (Object.hasOwn(EN, text)) return EN[text as TranslationKey];
  for (const { regex, names, value } of patterns) {
    const match = regex.exec(text);
    if (match) return names.reduce((result, name, i) => result.replaceAll(`{${name}}`, (/^-?\d+(?:\.\d+)?$/.test(match[i + 1]) ? new Intl.NumberFormat('en-US').format(Number(match[i + 1])) : translateSystem(locale, match[i + 1]))), value as string);
  }
  // Legacy status explanations combine numeric metrics; translate only their units.
  return text.replace(/недостаточно данных/g, 'not enough data').replace(/дн\./g, 'days').replace(/км/g, 'km');
}
export function createCopy(locale: Locale) {
  return {
    RU: locale === 'en' ? englishCopy : RU,
    locale, intlLocale: intlLocale(locale),
    t: (key: TranslationKey) => translate(locale, key),
    systemText: (text: string) => translateSystem(locale, text),
    errorMessageText: (text: string) => {
      const translated = translateSystem(locale, text);
      return locale === 'en' && /[А-Яа-яЁё]/.test(translated)
        ? EN['Не удалось выполнить действие. Попробуйте ещё раз.'] : translated;
    },
    path: (pathname: string) => localizedPath(pathname, locale),
    formatMileageInput: (value: string | number) => {
      const formatted = formatMileageInputRu(value);
      return locale === 'en' ? formatted.replace(/ /g, ',') : formatted;
    },
    formatNumber: (value: number) => new Intl.NumberFormat(intlLocale(locale)).format(value),
    formatDate: (date: Date) => new Intl.DateTimeFormat(intlLocale(locale), { month: 'short', day: 'numeric', year: 'numeric' }).format(date),
    formatDateTime: (date: Date) => locale === 'ru' ? formatDateTimeRu(date) : new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' }).format(date),
    displayDateTime: (date: Date) => locale === 'ru' ? displayDateTimeRu(date) : new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' }).format(date),
    formatServiceTimeFromSignedDays: (days: number) => translateSystem(locale, serviceTimeRu(days)),
  };
}
