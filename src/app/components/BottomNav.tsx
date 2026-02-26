'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RU } from '@/lib/copy/ru';

export default function BottomNav() {
  const pathname = usePathname();

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
    </nav>
  );
}

