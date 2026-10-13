'use client';
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createCopy } from './copy';
import { localeFromPath, readOAuthLocale, type Locale } from './routing';
const LocaleContext = createContext<Locale | null>(null);
const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
export function useHydrated() {
  return useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
}
export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Rewrites expose the internal pathname during SSR. Use the request locale
  // through hydration, then the visible URL for navigation and Back/Forward.
  const hydrated = useHydrated();
  const locale = !hydrated ? initialLocale
    : pathname === '/auth/recover' ? initialLocale
    : pathname === '/auth/callback' ? readOAuthLocale(initialLocale) : localeFromPath(pathname);
  const copy = useMemo(() => createCopy(locale), [locale]);
  useEffect(() => {
    // Wait until Next has committed the native-history URL before refreshing.
    // Refreshing in the click handler would still fetch the previous locale.
    if (hydrated && pathname !== '/auth/callback' && pathname !== '/auth/recover' && locale !== initialLocale) router.refresh();
  }, [hydrated, pathname, locale, initialLocale, router]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', locale === 'en' ? '/manifest.webmanifest?lang=en' : '/manifest.webmanifest');
    document.title = copy.RU.metadata.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', copy.RU.metadata.description);
  }, [locale, copy]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useCopy() {
  const provided = useContext(LocaleContext);
  const pathname = usePathname();
  const locale = provided ?? (pathname === '/auth/callback' ? readOAuthLocale('ru') : localeFromPath(pathname));
  return useMemo(() => createCopy(locale), [locale]);
}
