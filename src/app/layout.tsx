import type { Metadata, Viewport } from 'next';
import './globals.css';
import BottomNav from './components/BottomNav';
import TopBreadcrumbsBar from './components/TopBreadcrumbsBar';
import { ToastProvider } from './components/ToastProvider';
import ScrollLockRouteGuard from './components/ScrollLockRouteGuard';
import AuthGate from './components/AuthGate';
import { RU } from '@/lib/copy/ru';
export const metadata: Metadata = {
  title: RU.metadata.title,
  description: RU.metadata.description,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <ToastProvider>
          <AuthGate />
          <ScrollLockRouteGuard />
          <div className="app-container">
            <main className="app-main">
              <TopBreadcrumbsBar />
              {children}
            </main>
            <BottomNav />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}

