import { callbackHome, type Locale } from '@/lib/i18n/routing';

/** Fixed app route allowlist; never reflect arbitrary URLs into navigation. */
export function recoveryPath(next: string | null, locale: Locale): string {
  if (next && /^\/(?:en(?:\/|$))?(?:items(?:\/[a-zA-Z0-9-]+)?|history)?(?:\?[^#]*)?$/.test(next)) return next;
  return callbackHome(locale);
}
