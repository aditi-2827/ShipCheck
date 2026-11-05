'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Overview' },
  { href: '/checks', label: 'Checks' },
  { href: '/issues', label: 'Issues' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/history', label: 'History' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">S</span>
        <span className="sidebar-brand-text">ShipCheck</span>
      </div>
      <div className="sidebar-section">
        <p className="sidebar-label">WORKSPACE</p>
        <nav>
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <Link href="/settings">
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
