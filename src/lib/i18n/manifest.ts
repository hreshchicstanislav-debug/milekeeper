import type { MetadataRoute } from 'next';
import { translate } from './copy';
import type { Locale } from './routing';

/**
 * Web app manifest, served by Next at `/manifest.webmanifest`.
 *
 * Note that this route must bypass the auth middleware: a manifest is fetched
 * with `credentials: omit` unless the <link> carries `crossorigin`, so the
 * request never carries the session cookies and the middleware would answer it
 * with a 307 to /login. See the matcher exclusions in `src/middleware.ts`.
 *
 * One manifest endpoint has localized copy and start_url, with a shared id
 * and scope. Language changes never create a second PWA identity.
 */
export function createManifest(locale: Locale = 'ru'): MetadataRoute.Manifest {
  return {
    id: '/',
    name: translate(locale, 'MileKeeper — пробег и обслуживание'),
    short_name: 'MileKeeper',
    description: translate(locale, 'Учёт пробега и обслуживания автомобиля'),
    lang: locale,
    start_url: locale === 'en' ? '/en' : '/',
    shortcuts: [
      { name: 'MileKeeper — RU', url: '/' },
      { name: 'MileKeeper — EN', url: '/en' },
    ],
    // Keeps /login and /auth/callback inside the installed app, so the OAuth
    // round-trip does not kick the user out to the browser.
    scope: '/',
    display: 'standalone',
    // Both match `--app-bg` in globals.css, which is what `html, body` paints.
    background_color: '#f2f2f7',
    theme_color: '#f2f2f7',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
