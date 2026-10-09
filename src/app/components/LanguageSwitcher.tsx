'use client';
import { usePathname } from 'next/navigation';
import { useCopy } from '@/lib/i18n/client';
import { localizedPath, rememberLocale, type Locale } from '@/lib/i18n/routing';
export default function LanguageSwitcher({ persistPreference = true }: { persistPreference?: boolean }) {
  const { locale, t } = useCopy();
  const pathname = usePathname();
  if (pathname === '/auth/callback') return null;
  const select = (next: Locale) => {
    if (next === locale) return;
    if (persistPreference) rememberLocale(next);
    // Native history integrates with Next navigation without remounting forms.
    const destination = localizedPath(window.location.pathname, next) + window.location.search + window.location.hash;
    window.history.pushState(null, '', destination);
    // LocaleProvider refreshes RSC copy after Next commits this URL,
    // preserving mounted form state and avoiding a request for the old URL.
  };
  return <div className="language-switcher" role="group" aria-label={t('Язык интерфейса')}>
    {(['ru', 'en'] as const).map(value => <button key={value} type="button" aria-pressed={locale === value} lang={value} onClick={() => select(value)}>{value.toUpperCase()}</button>)}
  </div>;
}
