'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { RU } from '@/lib/copy/ru';

export default function BottomNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => document.documentElement.style.setProperty('--tabbar-height', `${nav.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  const navItems = [
    { href: '/', label: RU.nav.home, icon: '🏠' },
    { href: '/items', label: RU.nav.items, icon: '🔧' },
    { href: '/history', label: RU.nav.history, icon: '📋' },
  ];

  return (
    <nav ref={navRef} className="bottom-nav" aria-label="Основная навигация">
      {navItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={`nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

