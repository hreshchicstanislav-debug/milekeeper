'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RU } from '@/lib/copy/ru';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browserClient';

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState<boolean>(false);

  const supabase = useMemo(() => createBrowserClient(), []);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) return;
      setIsAuthed(!!data.session);
    };
    run();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setIsAuthed(!!session);
    });
    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const navItems = [
    { href: '/', label: RU.nav.home, icon: '🏠' },
    { href: '/items', label: RU.nav.items, icon: '🔧' },
    { href: '/history', label: RU.nav.history, icon: '📋' },
  ];

  return (
    <nav className="bottom-nav">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </Link>
        );
      })}

      {/* MVP: logout action (only when authed) */}
      {isAuthed && (
        <button
          type="button"
          className="nav-item"
          onClick={async () => {
            try {
              await supabase.auth.signOut();
              await fetch('/api/auth/logout', { method: 'POST' });
            } finally {
              router.replace('/login');
            }
          }}
          style={{ background: 'transparent', border: 0 }}
        >
          <span className="nav-icon">🚪</span>
          <span className="nav-label">Выйти</span>
        </button>
      )}
    </nav>
  );
}

