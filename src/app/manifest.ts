import type { MetadataRoute } from 'next';

/**
 * Web app manifest, served by Next at `/manifest.webmanifest`.
 *
 * Note that this route must bypass the auth middleware: a manifest is fetched
 * with `credentials: omit` unless the <link> carries `crossorigin`, so the
 * request never carries the session cookies and the middleware would answer it
 * with a 307 to /login. See the matcher exclusions in `src/middleware.ts`.
 *
 * The strings live here rather than in `@/lib/copy/ru` because they are not UI
 * copy: the manifest is a single static artifact baked per deploy and read by
 * the OS at install time, not something a component renders.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MileKeeper — пробег и обслуживание',
    short_name: 'MileKeeper',
    description: 'Учёт пробега и обслуживания автомобиля',
    lang: 'ru',
    start_url: '/',
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
