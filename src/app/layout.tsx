import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from './components/ToastProvider';
import { getCopy } from '@/lib/i18n/server';
import { LocaleProvider } from '@/lib/i18n/client';
import AppShell from './components/AppShell';
export async function generateMetadata(): Promise<Metadata> {
  const { RU, locale } = await getCopy();
  return { title: RU.metadata.title, description: RU.metadata.description, manifest: locale === 'en' ? '/manifest.webmanifest?lang=en' : '/manifest.webmanifest' };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Same value as `--app-bg` in globals.css and as the manifest's theme_color.
  // Deliberately no `viewportFit: 'cover'`: the safe-area insets in globals.css
  // currently resolve to 0, and opting into the full viewport would make them
  // real and shift the layout. That is a separate, visual change.
  themeColor: '#f2f2f7',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await getCopy();
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
