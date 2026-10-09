'use client';

import { usePathname } from 'next/navigation';
import { isDemoPath } from '@/lib/demo/routing';
import AuthGate from './AuthGate';
import BottomNav from './BottomNav';
import TopBreadcrumbsBar from './TopBreadcrumbsBar';
import ScrollLockRouteGuard from './ScrollLockRouteGuard';
import LanguageSwitcher from './LanguageSwitcher';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const demo = isDemoPath(usePathname());
  return <>
    {!demo && <><AuthGate /><ScrollLockRouteGuard /></>}
    <div className={`app-container${demo ? ' demo-shell' : ''}`}>
      <main className="app-main">
        <LanguageSwitcher persistPreference={!demo} />
        {!demo && <TopBreadcrumbsBar />}
        {children}
      </main>
      {!demo && <BottomNav />}
    </div>
  </>;
}
