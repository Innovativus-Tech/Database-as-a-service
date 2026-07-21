'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Database,
  Table2,
  Upload,
  Link2,
  Activity,
  Settings,
  Cog,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

const sections = [
  {
    label: 'Databases',
    items: [
      { href: '/dashboard',  label: 'Overview',      icon: LayoutGrid },
      { href: '/databases',  label: 'My Databases',  icon: Database },
      { href: '/browse',     label: 'Browse Data',   icon: Table2 },
      { href: '/import',     label: 'Import Data',   icon: Upload },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/connections', label: 'Connection Strings', icon: Link2 },
      { href: '/usage',       label: 'Usage & Stats',      icon: Activity },
      { href: '/settings',    label: 'Settings',           icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, email, logout } = useAuth();
  const name = user?.displayName || user?.fullName || email;
  const initial = (name || '?')[0].toUpperCase();

  const visibleSections = user?.role === 'admin'
    ? [...sections, {
        label: 'Admin',
        items: [{ href: '/admin', label: 'Admin Panel', icon: ShieldCheck }],
      }]
    : sections;

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-55 flex-col border-r border-border bg-bg-sidebar">
      {/* Logo */}
      <div className="flex h-13 items-center gap-2 border-b border-border px-4">
        <span className="inline-block h-2 w-2 rounded-sm bg-accent" />
        <span className="text-md font-semibold tracking-tight">CustomDB</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {visibleSections.map((section) => (
          <div key={section.label} className="mb-6">
            <div className="px-3 pb-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group flex h-10 items-center gap-3 rounded px-3 text-sm transition-colors',
                        active
                          ? 'bg-accent-dim text-text-primary'
                          : 'text-text-secondary hover:bg-bg-inset hover:text-text-primary'
                      )}
                    >
                      {active && <span className="absolute left-0 h-5 w-0.5 rounded-r bg-accent" />}
                      <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={1.75} />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded px-2 py-2">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-dim text-xs font-medium text-accent">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-text-primary">{name || 'Not signed in'}</div>
            <div className="truncate text-xs text-text-muted">{user?.organizationName || email || ''}</div>
          </div>
          <button
            onClick={logout}
            className="rounded p-1.5 text-text-secondary hover:bg-bg-inset hover:text-text-primary"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  );
}
