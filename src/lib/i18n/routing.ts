export type Locale = 'ru' | 'en';
export const LOCALE_HEADER = 'x-milekeeper-locale';
export const LOCALE_COOKIE = 'mk_locale';
export const OAUTH_LOCALE_KEY = 'milekeeper:oauth-locale';
export function localeFromPath(pathname: string): Locale {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'ru';
}
export function stripLocale(pathname: string): string {
  return localeFromPath(pathname) === 'en' ? pathname.slice(3) || '/' : pathname;
}
export function localizedPath(pathname: string, locale: Locale): string {
  const path = stripLocale(pathname);
  // Shared endpoints and assets must never get a language prefix.
  if (path === '/auth/callback' || path.startsWith('/api/') || path.startsWith('/_next/')) return path;
  return locale === 'en' ? `/en${path === '/' ? '' : path}` : path;
}
export function callbackLocale(value: unknown): Locale { return value === 'en' ? 'en' : 'ru'; }
/** The callback destination is selected from two constants, never a supplied URL. */
export function callbackHome(value: unknown): string { return callbackLocale(value) === 'en' ? '/en' : '/'; }
export function rememberLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}
export function saveOAuthLocale(locale: Locale) {
  rememberLocale(locale);
  try { sessionStorage.setItem(OAUTH_LOCALE_KEY, locale); } catch { /* cookie fallback */ }
}
export function readOAuthLocale(fallback: Locale): Locale {
  try {
    const value = sessionStorage.getItem(OAUTH_LOCALE_KEY);
    if (value === 'en' || value === 'ru') return value;
  } catch { /* cookie fallback supplied by root layout */ }
  return fallback;
}
