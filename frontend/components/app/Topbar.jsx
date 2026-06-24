'use client';

import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function Topbar({ title, subtitle, breadcrumbs, actions }) {
  const { user, email } = useAuth();
  const initial = (user?.displayName || user?.fullName || email || '?')[0].toUpperCase();

  return (
    <div className="sticky top-0 z-20 flex h-13 items-center justify-between border-b border-border bg-bg-base/80 px-8 backdrop-blur-md">
      <div className="min-w-0">
        {breadcrumbs ? (
          <div className="text-sm text-text-secondary">
            {breadcrumbs.map((crumb, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1.5 text-text-muted">/</span>}
                {i === breadcrumbs.length - 1 ? (
                  <span className="text-text-primary">{crumb}</span>
                ) : (
                  <span>{crumb}</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <>
            <h1 className="truncate text-md font-medium text-text-primary">{title}</h1>
            {subtitle && <p className="truncate text-xs text-text-secondary">{subtitle}</p>}
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        {actions && <div className="flex items-center gap-2">{actions}</div>}
        <button className="text-text-secondary hover:text-text-primary transition-colors">
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-dim text-xs font-semibold text-accent">
            {initial}
          </div>
        )}
      </div>
    </div>
  );
}
