'use client';

import { cn } from '@/lib/cn';

const variants = {
  success:      { dot: 'bg-success',  ring: 'ring-success/30',  text: 'text-success'  },
  warning:      { dot: 'bg-warning',  ring: 'ring-warning/30',  text: 'text-warning'  },
  gray:         { dot: 'bg-gray',     ring: 'ring-gray/30',     text: 'text-text-secondary' },
  danger:       { dot: 'bg-danger',   ring: 'ring-danger/30',   text: 'text-danger'   },
  mongo:        { dot: 'bg-mongo',    ring: 'ring-mongo/30',    text: 'text-mongo'    },
  postgres:     { dot: 'bg-postgres', ring: 'ring-postgres/30', text: 'text-postgres' },
  accent:       { dot: 'bg-accent',   ring: 'ring-accent/30',   text: 'text-accent'   },
};

export default function Badge({ children, variant = 'gray', dot = true, pulse = false, size = 'sm', className }) {
  const v = variants[variant] || variants.gray;
  const sizeClasses = size === 'md' ? 'px-2.5 py-1 text-[12px]' : 'px-[9px] py-1 text-[12px]';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm bg-bg-inset font-medium ring-1 ring-inset',
        sizeClasses,
        v.ring,
        v.text,
        className
      )}
    >
      {dot && (
        <span className={cn('relative inline-block h-1.5 w-1.5 rounded-full', v.dot)}>
          {pulse && (
            <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', v.dot)} />
          )}
        </span>
      )}
      {children}
    </span>
  );
}
