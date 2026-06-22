'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export default function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cn('relative flex items-center gap-6 border-b border-border', className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative pb-3 text-base font-medium transition-colors',
              active
                ? 'text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            <span className="flex items-center gap-2">
              {t.icon}
              {t.label}
              {t.badge != null && (
                <span className="rounded-sm bg-bg-inset px-1.5 py-0.5 text-[10px] text-text-muted">
                  {t.badge}
                </span>
              )}
            </span>
            {active && (
              <motion.span
                layoutId="tab-indicator"
                className="absolute inset-x-0 -bottom-px h-[2px] bg-accent"
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
