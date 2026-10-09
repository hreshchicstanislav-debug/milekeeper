import type { Locale } from '@/lib/i18n/routing';

/** Shared by RU/EN; contains no demo data or account preferences. */
export const DEMO_WELCOME_KEY = 'milekeeper.demo.welcome.v1';

export function hasSeenDemoWelcome(): boolean {
  try { return window.localStorage.getItem(DEMO_WELCOME_KEY) === 'seen'; }
  catch { return false; }
}

export function rememberDemoWelcome(): void {
  try { window.localStorage.setItem(DEMO_WELCOME_KEY, 'seen'); }
  catch { /* Storage denial must not prevent closing or using the demo. */ }
}

export const demoWelcomeCopy = {
  ru: {
    title: 'Обслуживание автомобиля под контролем',
    intro: 'MileKeeper помогает следить за пробегом и понимать, когда потребуется следующее обслуживание.',
    detail: 'Записывайте показания одометра и замены — приложение рассчитает остаток до обслуживания, а по истории пробега сможет оценить срок в днях.',
    badge: 'Сейчас вы смотрите демо',
    fictional: 'Все данные вымышленные. Вы можете свободно изучать пример.',
    explore: 'Исследовать демо', about: 'О MileKeeper', close: 'Закрыть приветствие',
  },
  en: {
    title: 'Keep your car maintenance on track',
    intro: 'MileKeeper helps you track mileage and see when your car may need maintenance.',
    detail: "Log odometer readings and replacements to see what's left until the next service. With enough mileage history, it can also estimate when that service may be due.",
    badge: "You're viewing a demo",
    fictional: 'All data is fictional. Feel free to explore the example.',
    explore: 'Explore demo', about: 'About MileKeeper', close: 'Close welcome',
  },
} satisfies Record<Locale, Record<string, string>>;
