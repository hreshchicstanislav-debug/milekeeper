'use client';

import { usePathname } from 'next/navigation';
import { isDemoPath } from '@/lib/demo/routing';
import AuthGate from './AuthGate';
import BottomNav from './BottomNav';
import TopBreadcrumbsBar from './TopBreadcrumbsBar';
import ScrollLockRouteGuard from './ScrollLockRouteGuard';
import LanguageSwitcher from './LanguageSwitcher';

// Resolve streamed RSC children in a component fiber, not the <main> host fiber.
// React 19.2 can replay a suspended host fiber without rewinding its hydration
// cursor, matching <main> against its own first child and raising error #418.
function PageContent({ children }: { children: React.ReactNode }) {
  return children;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const demo = isDemoPath(usePathname());
  return <>
    {!demo && <><AuthGate /><ScrollLockRouteGuard /></>}
    <div className={`app-container${demo ? ' demo-shell' : ''}`}>
      <main className="app-main">
        <LanguageSwitcher persistPreference={!demo} />
        {!demo && <TopBreadcrumbsBar />}
        <PageContent>{children}</PageContent>
      </main>
      {!demo && <BottomNav />}
    </div>
  </>;
}
