'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getScrollLockCount, resetScrollLocks } from '@/lib/ui/scrollLock';
import { isAnyModalOpen, getModalCount } from '@/lib/ui/modalOpen';

/**
 * Global guard to reset stuck scroll locks on route changes
 * Prevents body scroll lock from persisting after navigation
 */
export default function ScrollLockRouteGuard() {
  const pathname = usePathname();
  const prevPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip on initial mount
    if (prevPathnameRef.current === null) {
      prevPathnameRef.current = pathname;
      return;
    }

    // Only act on actual route changes
    if (prevPathnameRef.current !== pathname) {
      const lockCount = getScrollLockCount();
      const modalCount = getModalCount();
      const hasOpenModal = isAnyModalOpen();

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[ScrollLockRouteGuard] Route change: ${prevPathnameRef.current} -> ${pathname}`, {
          lockCount,
          modalCount,
          hasOpenModal,
          willReset: lockCount > 0 && !hasOpenModal,
        });
      }

      // Reset locks only if they are stuck (lockCount > 0 but no modal is open)
      // If modal is open, lock is legitimate and should not be reset
      if (lockCount > 0 && !hasOpenModal) {
        resetScrollLocks(`route-change:${prevPathnameRef.current}->${pathname}`);
      }

      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  return null;
}

