import type { Locale } from '@/lib/i18n/routing';
import type { SoonMaintenanceItem } from '@/lib/home/soonMaintenance';

export const loginChoiceCopy = {
  ru: { demo: 'Посмотреть демо', google: 'Войти через Google' },
  en: { demo: 'Explore demo', google: 'Continue with Google' },
} satisfies Record<Locale, { demo: string; google: string }>;

const ru = {
  badge: 'Демонстрация · вымышленные данные',
  title: 'Пробег и обслуживание',
  intro: 'Посмотрите, как MileKeeper оценивает пробег и помогает следить за обслуживанием автомобиля.',
  date: 'Дата примера',
  actual: 'Последний измеренный пробег', measuredOn: 'Показание от',
  estimated: 'Расчётный пробег', rate: 'Средний темп поездок', km: 'км', perDay: 'км/день',
  explanation: 'Показание — записанный факт. Расчётный пробег — оценка между замерами при похожем темпе поездок. Она не заменяет новое показание.',
  soon: 'Ближайшее обслуживание', all: 'Элементы в примере',
  distance: 'Остаток по пробегу', calendar: 'Срок по календарю', missing: 'Дата последней замены ещё не указана.',
  forecast: 'Сроки по пробегу — прогноз. Календарные сроки отсчитываются от даты обслуживания.',
  exit: 'Перейти к своим данным', back: 'Вернуться ко входу',
  exitHelp: 'Для своих данных войдите через Google. Если вы уже вошли, откроется ваш аккаунт. Пример не сохраняется в нём.',
  items: { oil: 'Масло двигателя', cabin: 'Салонный фильтр', air: 'Воздушный фильтр', brake: 'Тормозная жидкость', wipers: 'Щётки стеклоочистителя' },
  statuses: { OVERDUE: 'Просрочено', SOON: 'Скоро', OK: 'В норме', UNKNOWN: 'Недостаточно данных' },
};
type DemoCopy = { [K in keyof typeof ru]: typeof ru[K] extends string ? string : { [P in keyof typeof ru[K]]: string } };
const en: DemoCopy = {
  badge: 'Demo · fictional data', title: 'Mileage and maintenance',
  intro: 'See how MileKeeper estimates mileage and helps you keep track of vehicle maintenance.',
  date: 'Example date',
  actual: 'Last measured odometer', measuredOn: 'Reading from',
  estimated: 'Estimated odometer', rate: 'Average driving pace', km: 'km', perDay: 'km/day',
  explanation: 'A reading is a recorded fact. Estimated mileage is a forecast between readings at a similar driving pace. It does not replace a new reading.',
  soon: 'Upcoming maintenance', all: 'Items in this example',
  distance: 'Mileage remaining', calendar: 'Calendar schedule', missing: 'The last replacement date has not been entered yet.',
  forecast: 'Mileage deadlines are forecasts. Calendar deadlines count from the maintenance date.',
  exit: 'Go to my own data', back: 'Back to sign in',
  exitHelp: 'Sign in with Google to use your own data. If you are already signed in, your account will open. This example is never saved to it.',
  items: { oil: 'Engine oil', cabin: 'Cabin air filter', air: 'Air filter', brake: 'Brake fluid', wipers: 'Wiper blades' },
  statuses: { OVERDUE: 'Overdue', SOON: 'Due soon', OK: 'On track', UNKNOWN: 'Insufficient data' },
};
export const demoCopy: Record<Locale, DemoCopy> = { ru, en };

/** Presentation only: the selection and remaining values come from the engine. */
export function formatDemoSoon(row: SoonMaintenanceItem, locale: Locale): string {
  if (row.isOverdue) return demoCopy[locale].statuses.OVERDUE;
  if (locale === 'ru') return row.eta;
  const days = row.computedRemainingDays;
  const km = row.computedRemainingKm;
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const duration = days === null ? '' : `${row.isCalendarMode ? '' : '~'}${number.format(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`;
  return duration + (!row.isCalendarMode && km !== null ? `${duration ? ' ' : ''}(${number.format(km)} km)` : '');
}
