'use client';

import { cn } from '@/lib/cn';

export default function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-16 text-center', className)}>
      {Icon && <Icon className="h-7 w-7 text-text-muted" strokeWidth={1.75} />}
      <h3 className="text-base font-medium text-text-primary">{title}</h3>
      {description && (
        <p className="max-w-sm text-[12px] text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
